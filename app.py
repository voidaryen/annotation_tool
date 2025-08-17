from flask import Flask, render_template, request, jsonify, Response
import os
import json
import re
import time
import logging
from typing import List, Dict, Any
from datetime import datetime

# 配置日志
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s',
    handlers=[
        logging.FileHandler('app.log'),
        logging.StreamHandler()
    ]
)

os.chdir(os.path.dirname(os.path.abspath(__file__)))

# 查看 config.py 是否存在
if os.path.exists(r'config.py'):
    from config import OPENAI_API_KEY, OPENAI_BASE_URL, MODEL
else:
    print("请添加配置文件 config.py")
    exit(1)

app = Flask(__name__)
zh_en_dict = {
    "Symptom":"主诉",
    "Dental":"牙性",
    "Tooth":"牙齿",
    "Skeletal":"骨性",
    "Softtissue":"软组织",
    "Functional":"功能",
    "Growth":"生长发育",
    "UnhealthyHabits":"不良习惯",
    "Functional":"功能",
    "TreatmentPlan":"诊疗方案"
}


# 配置数据目录
DATA_DIR = "data"
PATIENTS_DIR = os.path.join(DATA_DIR, "patients")
ANNOTATIONS_DIR = os.path.join(DATA_DIR, "annotations")
ACTION_LIBRARY_FILE = os.path.join(DATA_DIR, "action_library.json")

# 确保数据目录存在
os.makedirs(PATIENTS_DIR, exist_ok=True)
os.makedirs(ANNOTATIONS_DIR, exist_ok=True)

# 创建备份目录
BACKUP_DIR = os.path.join(DATA_DIR, "backups")
os.makedirs(BACKUP_DIR, exist_ok=True)

def create_backup(file_path, content):
    """创建文件备份"""
    try:
        backup_name = f"{os.path.basename(file_path)}_{datetime.now().strftime('%Y%m%d_%H%M%S')}.bak"
        backup_path = os.path.join(BACKUP_DIR, backup_name)
        with open(backup_path, 'w', encoding='utf-8') as f:
            if isinstance(content, dict):
                json.dump(content, f, ensure_ascii=False, indent=2)
            else:
                f.write(content)
        logging.info(f"创建备份: {backup_path}")
    except Exception as e:
        logging.error(f"创建备份失败: {e}")

def validate_patient_data(data):
    """验证患者数据"""
    required_fields = ['patient_id', 'annotations', 'solutions']
    for field in required_fields:
        if field not in data:
            raise ValueError(f"缺少必要字段: {field}")
    
    if not isinstance(data['solutions'], list):
        raise ValueError("solutions 必须是列表")
    
    if not isinstance(data['annotations'], dict):
        raise ValueError("annotations 必须是字典")
    
    return True

def load_action_library() -> List[str]:
    """加载诊疗动作库"""
    if os.path.exists(ACTION_LIBRARY_FILE):
        with open(ACTION_LIBRARY_FILE, 'r', encoding='utf-8') as f:
            return json.load(f)
    else:
        # 初始默认动作库
        default_actions = [
            "排齐牙列",
            "解除拥挤",
            "纠正中线",
            "调整磨牙关系",
            "内收前牙",
            "压低前牙",
            "片切",
            "拔除智齿",
            "正畸保持",
            "纠正扭转牙",
            "排齐上颌牙列",
            "排齐下颌牙列"
        ]
        save_action_library(default_actions)
        return default_actions

def save_action_library(actions: List[str]):
    """保存诊疗动作库"""
    with open(ACTION_LIBRARY_FILE, 'w', encoding='utf-8') as f:
        json.dump(actions, f, ensure_ascii=False, indent=2)

def parse_patient_file(content: str) -> Dict[str, Any]:
    """解析病历文件内容"""
    result = {
        "problems": [],
        "treatment_plan": ""
    }

    # 诊疗方案拆分
    parts = content.split("TreatmentPlan<sep>")
    infos = parts[0]
    treatment_plan = parts[1] if len(parts) > 1 else ""
    treatment_plan = '\n'.join(treatment_plan.split('<sep>')).strip() if treatment_plan else ""
    lines = infos.strip().split('\n')
    current_section = None
    
    for line in lines:
        line = line.strip()
        if not line:  continue

        if line.startswith("Patient"): continue
        problem_type = line.split("<sep>")[0].strip()
        problems = line.split("<sep>")[1:]
        problem = [''.join(problems).strip()]
        current_section = zh_en_dict.get(problem_type, None)

        result["problems"].append({
            "id": f"problem-{len(result['problems'])}",
            "text": problem,
            "type": current_section
        })

    # 处理诊疗方案
    result["treatment_plan"] = treatment_plan
    
    return result

from openai import OpenAI

def call_llm(prompt: str, test_mode: bool=False) -> str:
    """调用LLM并返回响应（模拟实现）"""
    if test_mode:
        print(f"Calling LLM with prompt: {prompt}")
        return "LLM response 1 \nLLM response 2"

    try:
        client = OpenAI(
            api_key=OPENAI_API_KEY, 
            base_url=OPENAI_BASE_URL
        )

        response = client.chat.completions.create(
            model=MODEL,
            messages=[
                {"role": "user", "content": prompt},
            ],
            stream=False
        )

        result = response.choices[0].message.content
        if result:
            return result.strip()
        else:
            return "LLM返回空内容"
    except Exception as e:
        print(f"LLM调用错误: {e}")
        # 返回测试模式的结果，确保系统能正常运行
        return "LLM调用失败，返回默认结果"

def call_llm_stream(prompt: str):
    """流式调用LLM并返回生成器"""
    try:
        client = OpenAI(
            api_key=OPENAI_API_KEY, 
            base_url=OPENAI_BASE_URL
        )

        stream = client.chat.completions.create(
            model=MODEL,
            messages=[
                {"role": "user", "content": prompt},
            ],
            stream=True
        )

        for chunk in stream:
            if chunk.choices[0].delta.content is not None:
                yield chunk.choices[0].delta.content
    except Exception as e:
        print(f"LLM流式调用错误: {e}")
        yield "LLM调用失败"


standardize_actions_prompt = """
你是一位专业的正畸医生助手，需要将口语化、描述性的正畸治疗计划拆分为标准化的诊疗动作。

任务要求：
1. 将输入的治疗计划文本拆分为具体的、可执行的诊疗动作
2. 每个动作应该是原子化的，即一个动作只描述一个具体的治疗手段
3. 使用标准的正畸医学术语
4. 去除费用、时间、风险提示等非治疗动作的内容
5. 每行输出一个诊疗动作，不要添加序号或其他格式
6. 尽可能保存所有动词以及包含的医学术语，因为这些都属于重要的手段信息
7. 方向前后也尽可能保留，位置信息和方向都属于重要的定位信息，比如"右移"、"左移"、"向后移动"等等
8. 如果一小句中有多个动作，每个动作都要单独输出，不要合并
9. 如果有多颗牙同时进行拆开，也要依次拆分
10. "适度""尝试"等程度词不做保存，保证动作的标准化特性


标准诊疗动作库：
[这里是标准诊疗动作库]

转换规则：
- "上下唇倾排齐，解除拥挤及扭转" → "排齐上颌牙列"、"排齐下颌牙列"、"解除拥挤"、"纠正扭转牙"
- "后牙锁合先利用矫治器纠正" → "纠正后牙锁合"
- "维持磨牙关系" → "维持磨牙关系"
- "上颌排齐整平后，拉17向近中，右侧直立27并拉向近中" → "排齐上颌牙列"、"整平上颌牙列"、"拉17向近中"、"右侧直立27"、"拉27向近中"
- "下颌右侧推磨牙向后开辟间隙" → "下颌右侧推磨牙向后"、"开辟间隙"
- "上颌前牙整体右移调整中线" → "前牙整体移动"、"纠正中线"
- "智齿酌情" → "拔除智齿"
- "正畸保持" → "正畸保持"
- "下颌左侧直立磨牙" → "下颌左侧直立磨牙"
- "必要时下前牙配合片切解决三角间隙" → "片切解决三角间隙"
- "13、46、47全冠修复" → "13全冠修复"、"46全冠修复"、"47全冠修复"
- "利用拔牙间隙排齐牙列，上前牙适度内收" → "排齐上颌牙列"、"排齐下颌牙列"、"内收上前牙"
- "双颌扩弓，前牙原地排齐（考虑到患者鼻唇角较小），末端回弯。" → "双颌扩弓"、"排齐上颌牙列"、"末端回弯"
- "左侧III类牵引配合推磨牙（考虑到下颌中线右偏），纠正左侧磨牙近中关系。" → "左侧III类牵引"、"推磨牙"、"纠正左侧磨牙近中关系"
- "压低上前牙纠正深覆合（考虑到ahead牙位置较上唇较高）" → "压低ahead牙"、"纠正深覆合"
- "斜行牵引纠正中线" → "斜行牵引"、"纠正中线"
- "下颌推磨牙向后纠正磨牙关系，配合扩弓排齐牙列" → "下颌推磨牙向后"、"纠正磨牙关系"、"配合扩弓"、"排齐牙列"
- "压低下前牙，尝试改善下颌角" → "压低下前牙"、"尝试改善下颌角"
- "利用现有间隙内收上下牙列关闭现有间隙" → "内收上下牙列"、"关闭现有间隙"
- "建立后牙稳定咬合关系及正常符合覆盖" → "建立后牙稳定咬合关系"
- "上颌少量扩弓，改善宽度不调" → "上颌扩弓"、"改善宽度不调"
- "下颌少量片切解除拥挤" → "下颌片切"、"解除拥挤"
- "压低下前牙整平牙列打开咬合" → "压低下前牙"、"整平牙列"、"打开咬合"
- "推双侧磨牙向远中" → "推双侧磨牙向远中"
- "利用上述间隙排齐牙齿，压低并内收上下前牙" → "排齐牙齿"、"压低ahead牙"、"压低下前牙"、"内收ahead牙"、"内收下前牙"
- "右侧适度推磨牙向后改善磨牙与尖牙关系" → "右侧推磨牙向后"、"改善磨牙关系"、"改善尖牙关系"
- "交互牵引解除右侧后牙正锁合" → "交互牵引"、"解除右侧后牙正锁合"
- "36酌情树脂或全冠修复" → "36全冠修复"、"36树脂修复"

请将以下治疗计划拆分为标准化的诊疗动作：
[这里是诊疗方案]
"""
def standardize_actions_with_llm(treatment_plan: str, action_library: List[str]) -> List[str]:
    """使用LLM标准化诊疗动作（模拟实现）"""
    # 这里是一个简化的实现，实际项目中应该调用真实的LLM API
    standardized = []
    action_library_text = "\n".join(action_library)
    prompt = standardize_actions_prompt
    prompt  = prompt.replace("[这里是标准诊疗动作库]", action_library_text)
    prompt = prompt.replace("[这里是诊疗方案]", treatment_plan)
    standardized.extend(call_llm(prompt, test_mode=False).split('\n'))

    # 去重并保持顺序
    seen = set()
    result = []
    for action in standardized:
        if action not in seen:
            seen.add(action)
            result.append(action)
    
    return result

@app.route('/')
def index():
    """主页面"""
    return render_template('index.html')

@app.route('/api/patients')
def get_patients():
    """获取所有患者ID列表"""
    try:
        patient_files = [f for f in os.listdir(PATIENTS_DIR) if f.endswith('.txt')]
        patient_ids = [os.path.splitext(f)[0] for f in patient_files]
        return jsonify({"patients": sorted(patient_ids)})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route('/api/last-edited-patient')
def get_last_edited_patient():
    """获取最近编辑的患者ID"""
    try:
        # 查找最近修改的标注文件
        if not os.path.exists(ANNOTATIONS_DIR):
            return jsonify({"patient_id": None})
        
        annotation_files = [f for f in os.listdir(ANNOTATIONS_DIR) if f.endswith('.json')]
        if not annotation_files:
            return jsonify({"patient_id": None})
        
        # 按修改时间排序，获取最近修改的文件
        annotation_files_with_time = []
        for f in annotation_files:
            file_path = os.path.join(ANNOTATIONS_DIR, f)
            mtime = os.path.getmtime(file_path)
            patient_id = os.path.splitext(f)[0]
            annotation_files_with_time.append((patient_id, mtime))
        
        # 按修改时间降序排序
        annotation_files_with_time.sort(key=lambda x: x[1], reverse=True)
        
        # 返回最近修改的患者ID
        latest_patient_id = annotation_files_with_time[0][0]
        return jsonify({"patient_id": latest_patient_id})
        
    except Exception as e:
        return jsonify({"patient_id": None})

@app.route('/api/patient/<patient_id>')
def get_patient_data(patient_id):
    """获取指定患者的数据"""
    try:
        # 检查是否强制重新生成
        force_regenerate = request.args.get('force_regenerate', 'false').lower() == 'true'
        
        # 读取病历文件
        patient_file = os.path.join(PATIENTS_DIR, f"{patient_id}.txt")
        if not os.path.exists(patient_file):
            return jsonify({"error": "患者文件不存在"}), 404
        
        with open(patient_file, 'r', encoding='utf-8') as f:
            content = f.read()
        
        # 解析病历
        parsed_data = parse_patient_file(content)
        
        # 检查是否存在已保存的标注文件
        annotation_file = os.path.join(ANNOTATIONS_DIR, f"{patient_id}.json")
        annotations = {}
        solutions = []
        has_saved_data = False
        
        # 如果不是强制重新生成，且存在标注文件，直接使用其中的数据
        if not force_regenerate and os.path.exists(annotation_file):
            # 如果存在标注文件，直接使用其中的数据
            with open(annotation_file, 'r', encoding='utf-8') as f:
                annotation_data = json.load(f)
                annotations = annotation_data.get("annotations", {})
                solutions = annotation_data.get("solutions", [])
                has_saved_data = True
                
            print(f"加载已保存的患者数据: {patient_id}, 包含 {len(solutions)} 个诊疗动作")
        elif force_regenerate:
            print(f"强制重新生成患者数据: {patient_id}")
            has_saved_data = False  # 设置为False以触发LLM调用
        
        return jsonify({
            "patient_id": patient_id,
            "problems": parsed_data["problems"],
            "solutions": solutions,
            "annotations": annotations,
            "original_treatment_plan": parsed_data["treatment_plan"],
            "has_saved_data": has_saved_data  # 标识是否有已保存的数据
        })
        
    except Exception as e:
        print(f"获取患者数据错误: {e}")
        return jsonify({"error": str(e)}), 500

@app.route('/api/save/<patient_id>', methods=['POST'])
def save_annotations(patient_id):
    """保存标注结果"""
    try:
        data = request.get_json()
        if not data:
            return jsonify({"error": "没有接收到数据"}), 400
        
        # 构建标注数据
        annotation_data = {
            "patient_id": patient_id,
            "annotations": data.get("annotations", {}),
            "solutions": data.get("solutions", []),
            "last_modified": datetime.now().isoformat(),
            "version": "1.0"
        }
        
        # 验证数据
        validate_patient_data(annotation_data)
        
        # 保存标注文件
        annotation_file = os.path.join(ANNOTATIONS_DIR, f"{patient_id}.json")
        
        # 如果文件已存在，创建备份
        if os.path.exists(annotation_file):
            with open(annotation_file, 'r', encoding='utf-8') as f:
                old_data = json.load(f)
            create_backup(annotation_file, old_data)
        
        # 保存新数据
        with open(annotation_file, 'w', encoding='utf-8') as f:
            json.dump(annotation_data, f, ensure_ascii=False, indent=2)
        
        # 更新动作库
        action_library = load_action_library()
        new_actions = [sol["text"] for sol in data.get("solutions", [])]
        
        # 合并新动作到库中
        updated = False
        for action in new_actions:
            if action not in action_library:
                action_library.append(action)
                updated = True
        
        if updated:
            save_action_library(action_library)
        
        logging.info(f"保存患者 {patient_id} 标注成功，包含 {len(annotation_data['solutions'])} 个动作")
        
        return jsonify({
            "success": True, 
            "message": "标注保存成功",
            "saved_actions": len(annotation_data['solutions'])
        })
        
    except ValueError as e:
        logging.error(f"数据验证失败: {e}")
        return jsonify({"error": f"数据验证失败: {str(e)}"}), 400
    except Exception as e:
        logging.error(f"保存标注失败: {e}")
        return jsonify({"error": str(e)}), 500

@app.route('/api/action/add/<patient_id>', methods=['POST'])
def add_new_action(patient_id):
    """为指定患者添加新的诊疗动作"""
    try:
        data = request.get_json()
        action_text = data.get('text', '').strip()
        
        if not action_text:
            return jsonify({"error": "动作文本不能为空"}), 400
        
        # 加载现有标注文件
        annotation_file = os.path.join(ANNOTATIONS_DIR, f"{patient_id}.json")
        if os.path.exists(annotation_file):
            with open(annotation_file, 'r', encoding='utf-8') as f:
                annotation_data = json.load(f)
        else:
            annotation_data = {
                "patient_id": patient_id,
                "annotations": {},
                "solutions": []
            }
        
        # 添加新动作
        new_action_id = f"action-{len(annotation_data['solutions'])}"
        new_action = {
            "id": new_action_id,
            "text": action_text
        }
        
        annotation_data['solutions'].append(new_action)
        
        # 保存文件
        with open(annotation_file, 'w', encoding='utf-8') as f:
            json.dump(annotation_data, f, ensure_ascii=False, indent=2)
        
        # 更新动作库
        action_library = load_action_library()
        if action_text not in action_library:
            action_library.append(action_text)
            save_action_library(action_library)
        
        return jsonify({
            "success": True,
            "action": new_action,
            "message": "新动作添加成功"
        })
        
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route('/api/action/delete/<patient_id>/<action_id>', methods=['DELETE'])
def delete_action(patient_id, action_id):
    """删除指定患者的诊疗动作"""
    try:
        # 加载现有标注文件
        annotation_file = os.path.join(ANNOTATIONS_DIR, f"{patient_id}.json")
        if not os.path.exists(annotation_file):
            return jsonify({"error": "标注文件不存在"}), 404
            
        with open(annotation_file, 'r', encoding='utf-8') as f:
            annotation_data = json.load(f)
        
        # 删除solutions中的动作
        solutions = annotation_data.get("solutions", [])
        solutions = [s for s in solutions if s["id"] != action_id]
        annotation_data["solutions"] = solutions
        
        # 删除相关的标注链接
        annotations = annotation_data.get("annotations", {})
        if action_id in annotations:
            del annotations[action_id]
        annotation_data["annotations"] = annotations
        
        # 保存文件
        with open(annotation_file, 'w', encoding='utf-8') as f:
            json.dump(annotation_data, f, ensure_ascii=False, indent=2)
        
        return jsonify({
            "success": True,
            "message": "动作删除成功"
        })
        
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route('/api/patient/<patient_id>/stream-actions')
def stream_actions(patient_id):
    """流式生成诊疗动作"""
    def generate():
        try:
            # 读取病历文件
            patient_file = os.path.join(PATIENTS_DIR, f"{patient_id}.txt")
            if not os.path.exists(patient_file):
                yield f"data: {json.dumps({'error': '患者文件不存在'})}\n\n"
                return
            
            with open(patient_file, 'r', encoding='utf-8') as f:
                content = f.read()
            
            # 解析病历
            parsed_data = parse_patient_file(content)
            raw_actions = parsed_data["treatment_plan"]
            
            if not raw_actions.strip():
                yield f"data: {json.dumps({'error': '没有找到诊疗方案'})}\n\n"
                return
            
            # 准备LLM提示
            action_library = load_action_library()
            action_library_text = "\n".join(action_library)
            prompt = standardize_actions_prompt
            prompt = prompt.replace("[这里是标准诊疗动作库]", action_library_text)
            prompt = prompt.replace("[这里是诊疗方案]", raw_actions)
            
            # 首先发送开始信号
            yield f"data: {json.dumps({'type': 'start', 'original_plan': raw_actions})}\n\n"
            time.sleep(0.3)
            
            # 获取完整的LLM响应
            try:
                full_response = call_llm(prompt)
                lines = full_response.split('\n')
                
                # 过滤和标准化动作
                actions = []
                for line in lines:
                    line = line.strip()
                    # 过滤掉空行、标题行、说明行等
                    if (line and 
                        not line.startswith('**') and 
                        not line.startswith('##') and 
                        not line.startswith('-') and
                        not line.startswith('以下') and
                        not line.startswith('标准') and
                        not line.startswith('请') and
                        len(line) > 2 and
                        len(line) < 100):  # 合理的长度范围
                        actions.append(line)
                
                # 流式发送每个动作
                for i, action in enumerate(actions):
                    action_data = {
                        'type': 'action',
                        'text': action,
                        'id': f"action-{i}"
                    }
                    yield f"data: {json.dumps(action_data)}\n\n"
                    time.sleep(0.5)  # 控制动画速度
                
                # 自动保存生成的结果
                solutions = [{"id": f"action-{i}", "text": action} for i, action in enumerate(actions)]
                annotation_data = {
                    "patient_id": patient_id,
                    "annotations": {},
                    "solutions": solutions,
                    "auto_generated": True,
                    "generated_time": time.time()
                }
                
                annotation_file = os.path.join(ANNOTATIONS_DIR, f"{patient_id}.json")
                with open(annotation_file, 'w', encoding='utf-8') as f:
                    json.dump(annotation_data, f, ensure_ascii=False, indent=2)
                
                # 更新动作库
                action_library = load_action_library()
                for action in actions:
                    if action not in action_library:
                        action_library.append(action)
                save_action_library(action_library)
                
                print(f"流式生成完成并自动保存: {patient_id}, {len(actions)} 个动作")
                
                # 发送完成信号
                yield f"data: {json.dumps({'type': 'complete', 'actions': actions, 'auto_saved': True})}\n\n"
                
            except Exception as llm_error:
                print(f"LLM处理错误: {llm_error}")
                # 使用默认动作作为备用
                default_actions = [
                    "排齐牙列",
                    "解除拥挤", 
                    "调整咬合",
                    "正畸保持"
                ]
                
                for i, action in enumerate(default_actions):
                    action_data = {
                        'type': 'action',
                        'text': action,
                        'id': f"action-{i}"
                    }
                    yield f"data: {json.dumps(action_data)}\n\n"
                    time.sleep(0.5)
                
                yield f"data: {json.dumps({'type': 'complete', 'actions': default_actions})}\n\n"
            
        except Exception as e:
            print(f"流式处理错误: {e}")
            yield f"data: {json.dumps({'type': 'error', 'message': str(e)})}\n\n"
    
    return Response(generate(), mimetype='text/event-stream', 
                   headers={'Cache-Control': 'no-cache',
                           'Connection': 'keep-alive'})

if __name__ == '__main__':
    app.run(debug=True, host='127.0.0.1', port=5000)

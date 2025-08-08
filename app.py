from flask import Flask, render_template, request, jsonify
import os
import json
import re
from typing import List, Dict, Any

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
    
    client = OpenAI(api_key="sk-e73e2fe0f0d3438d8dfe2e93ec02eac7", base_url="https://api.deepseek.com")

    response = client.chat.completions.create(
        model="deepseek-chat",
        messages=[
            {"role": "user", "content": prompt},
        ],
        stream=False
    )

    result = response.choices[0].message.content.strip()
    return result


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


标准诊疗动作示例：
- 排齐牙列
- 解除拥挤
- 纠正中线
- 调整磨牙关系
- 内收前牙
- 压低前牙
- 片切
- 拔除智齿
- 正畸保持
- 纠正扭转牙
- 排齐上颌牙列
- 排齐下颌牙列
- 推磨牙向后
- 开辟间隙
- 前牙整体移动
- 关闭间隙
- 扩弓
- 收弓
- 调整覆盖覆合
- 矫正偏颌
- 建立尖窝关系
- 牙齿扭转矫正
- 牙齿倾斜矫正
- 牙弓协调
- 咬合重建
- 智齿酌情

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
"""
def standardize_actions_with_llm(treatment_plan: str, action_library: List[str]) -> List[str]:
    """使用LLM标准化诊疗动作（模拟实现）"""
    # 这里是一个简化的实现，实际项目中应该调用真实的LLM API
    standardized = []
    standardized.extend(call_llm(standardize_actions_prompt + "\n" + treatment_plan, test_mode=False).split('\n'))


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

@app.route('/api/patient/<patient_id>')
def get_patient_data(patient_id):
    """获取指定患者的数据"""
    try:
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
        
        if os.path.exists(annotation_file):
            # 如果存在标注文件，优先使用其中的solutions和annotations
            with open(annotation_file, 'r', encoding='utf-8') as f:
                annotation_data = json.load(f)
                annotations = annotation_data.get("annotations", {})
                solutions = annotation_data.get("solutions", [])
                
            # 如果标注文件中没有solutions，则从原始数据生成并自动添加
            if not solutions:
                raw_actions = parsed_data["treatment_plan"]
                action_library = load_action_library()
                standardized_actions = standardize_actions_with_llm(raw_actions, action_library)
                
                # 为动作生成ID并添加到solutions
                for i, action in enumerate(standardized_actions):
                    if action.strip():  # 确保动作不为空
                        solutions.append({
                            "id": f"action-{i}",
                            "text": action.strip()
                        })
                print(solutions)
                # 自动保存生成的solutions到标注文件
                annotation_data["solutions"] = solutions
                with open(annotation_file, 'w', encoding='utf-8') as f:
                    json.dump(annotation_data, f, ensure_ascii=False, indent=2)
                
                # 更新动作库
                action_library = load_action_library()
                for solution in solutions:
                    action_text = solution["text"]
                    if action_text not in action_library:
                        action_library.append(action_text)
                save_action_library(action_library)
                
        else:
            # 如果不存在标注文件，从原始数据生成solutions并自动保存
            raw_actions = parsed_data["treatment_plan"]
            action_library = load_action_library()
            standardized_actions = standardize_actions_with_llm(raw_actions, action_library)
            
            # 为动作生成ID
            for i, action in enumerate(standardized_actions):
                if action.strip():  # 确保动作不为空
                    solutions.append({
                        "id": f"action-{i}",
                        "text": action.strip()
                    })
            
            # 创建新的标注文件并保存
            annotation_data = {
                "patient_id": patient_id,
                "annotations": annotations,
                "solutions": solutions
            }
            
            with open(annotation_file, 'w', encoding='utf-8') as f:
                json.dump(annotation_data, f, ensure_ascii=False, indent=2)
            
            # 更新动作库
            action_library = load_action_library()
            for solution in solutions:
                action_text = solution["text"]
                if action_text not in action_library:
                    action_library.append(action_text)
            save_action_library(action_library)
        
        return jsonify({
            "patient_id": patient_id,
            "problems": parsed_data["problems"],
            "solutions": solutions,
            "annotations": annotations
        })
        
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route('/api/save/<patient_id>', methods=['POST'])
def save_annotations(patient_id):
    """保存标注结果"""
    try:
        data = request.get_json()
        
        # 保存标注文件
        annotation_file = os.path.join(ANNOTATIONS_DIR, f"{patient_id}.json")
        annotation_data = {
            "patient_id": patient_id,
            "annotations": data.get("annotations", {}),
            "solutions": data.get("solutions", [])
        }
        
        with open(annotation_file, 'w', encoding='utf-8') as f:
            json.dump(annotation_data, f, ensure_ascii=False, indent=2)
        
        # 更新动作库
        action_library = load_action_library()
        new_actions = [sol["text"] for sol in data.get("solutions", [])]
        
        # 合并新动作到库中
        for action in new_actions:
            if action not in action_library:
                action_library.append(action)
        
        save_action_library(action_library)
        
        return jsonify({"success": True, "message": "标注保存成功"})
        
    except Exception as e:
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

if __name__ == '__main__':
    app.run(debug=True, host='127.0.0.1', port=5000)

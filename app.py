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

这里是prompt

"""
def standardize_actions_with_llm(treatment_plan: str, action_library: List[str]) -> List[str]:
    """使用LLM标准化诊疗动作（模拟实现）"""
    # 这里是一个简化的实现，实际项目中应该调用真实的LLM API
    standardized = []
    standardized.extend(call_llm(standardize_actions_prompt + "\n" + treatment_plan, test_mode=True).split('\n'))


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
        
        # 处理治疗方案
        raw_actions = parsed_data["treatment_plan"]
        action_library = load_action_library()
        standardized_actions = standardize_actions_with_llm(raw_actions, action_library)
        
        # 为动作生成ID
        solutions = []
        for i, action in enumerate(standardized_actions):
            solutions.append({
                "id": f"action-{i}",
                "text": action
            })
        
        # 加载现有标注
        annotation_file = os.path.join(ANNOTATIONS_DIR, f"{patient_id}.json")
        annotations = {}
        if os.path.exists(annotation_file):
            with open(annotation_file, 'r', encoding='utf-8') as f:
                annotation_data = json.load(f)
                annotations = annotation_data.get("annotations", {})
        
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

if __name__ == '__main__':
    app.run(debug=True, host='127.0.0.1', port=5000)

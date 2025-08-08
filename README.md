# 正畸"症状-方案"逻辑关系标注工具

## 项目介绍

这是一个基于Flask和原生JavaScript开发的正畸领域标注工具，用于建立"问题（症状/检查发现）"与"诊疗动作"之间的因果逻辑关系。

## 功能特点

- 🏥 **智能解析**：自动解析病历文本，提取问题和治疗方案
- 🎯 **交互标注**：直观的点击式界面，轻松建立逻辑链接
- 🤖 **方案标准化**：利用LLM将复杂方案拆解为标准化动作
- 💾 **数据持久化**：自动保存标注结果和动作库
- 🔄 **知识复用**：动作库持续学习，提高标准化准确性

## 安装与使用

### 1. 环境准备

确保已安装Python 3.10，然后安装依赖：

```bash
pip install -r requirements.txt
```

### 2. 启动应用

在项目根目录下运行：

```bash
python app.py
```

### 3. 访问应用

在浏览器中打开：`http://127.0.0.1:5000`

## 使用指南

### 基本工作流程

1. **启动应用**：运行`python app.py`
2. **选择患者**：页面会自动加载第一个患者，也可通过下拉菜单选择
3. **建立链接**：
   - 点击右侧诊疗动作，该动作会高亮显示
   - 点击左侧相关问题，建立逻辑链接
   - 再次点击已链接的问题可取消链接
4. **编辑动作**：双击右侧诊疗动作可直接编辑文本
5. **保存标注**：点击"保存标注"按钮保存结果
6. **导航患者**：使用"上一例"/"下一例"按钮切换患者

### 快捷键

- `Ctrl+S`：保存标注
- `Ctrl+←`：上一个患者
- `Ctrl+→`：下一个患者

### 界面说明

#### 左侧面板：问题区域
- 显示从病历中提取的症状和检查发现
- 蓝色边框：普通问题
- 绿色边框：已与当前选中动作建立链接的问题

#### 右侧面板：诊疗动作区域
- 显示标准化后的诊疗动作
- 蓝色边框：普通动作
- 深蓝色背景：当前选中的动作
- 双击可编辑动作文本

## 数据格式

### 患者病历格式（.txt文件）

```
Patient<sep>这是姓名<sep>ID:00001
Symptom<sep>牙不齐
Dental<sep>上中线右偏<sep>偏移距离:2mm
Dental<sep>上下牙弓不对称
Dental<sep>上下牙弓卵圆形
Dental<sep>下牙弓宽度略窄
Tooth<sep>37<sep>问题:全冠修复
Dental<sep>前牙覆盖正常<sep>覆盖值:2mm
Dental<sep>右侧磨牙中性关系
Dental<sep>左侧磨牙中性关系
Dental<sep>恒牙期
Dental<sep>前牙覆合正常
Dental<sep>Bolton指数<sep>前牙比:79.1%<sep>全牙比:91.5%
Dental<sep>Spee曲线<sep>曲线值:2.5mm
Dental<sep>上牙列中度拥挤<sep>拥挤度:5.5mm
Dental<sep>下牙列轻度拥挤<sep>拥挤度:4mm
Tooth<sep>18<sep>问题:可见
Tooth<sep>48<sep>问题:可见
Tooth<sep>37<sep>问题:RCT后
Skeletal<sep>骨性I类
Skeletal<sep>颏部发育过度
Skeletal<sep>垂直向低角型
Softtissue<sep>颏点基本居中
Softtissue<sep>侧面观凹面型
Softtissue<sep>面下1/3正常
Functional<sep>下颌运动正常
Functional<sep>开口型正常
Growth<sep>无生长发育潜力
UnhealthyHabits<sep>吸烟
TreatmentPlan<sep>隐形矫治、不拔牙矫治<sep>id:1<sep>矫治目标:无<sep>矫治步骤:1. 上下唇倾排齐，解除拥挤及扭转
2. 后牙锁合先利用矫治器纠正，若无法完成则利用交互牵引纠正
3. 维持磨牙关系
4. 因27根尖炎反复发作，正畸治疗过程中牙根吸收、炎症加剧甚至无法保留的可能性。
5. 智齿酌情
6. 正畸保持<sep>矫治费用:30000元

```

### 标注结果格式（JSON文件）

```json
{
  "patient_id": "00001",
  "annotations": {
    "action-0": ["problem-0", "problem-1"],
    "action-1": ["problem-2"]
  },
  "solutions": [
    {"id": "action-0", "text": "排齐上颌牙列"},
    {"id": "action-1", "text": "解除拥挤"}
  ]
}
```

## 目录结构

```
workspace/
├── app.py                  # Flask后端主程序
├── requirements.txt        # Python依赖
├── templates/
│   └── index.html         # 前端页面
├── static/
│   ├── css/
│   │   └── style.css      # 样式文件
│   └── js/
│       └── script.js      # JavaScript逻辑
└── data/
    ├── patients/          # 病历文件
    ├── annotations/       # 标注结果
    └── action_library.json # 动作库
```

## 添加新患者数据

1. 在`data/patients/`目录下创建新的`.txt`文件
2. 文件名格式：`患者ID.txt`（如：`00004.txt`）
3. 按照病历格式编写内容
4. 刷新页面即可看到新患者

## 注意事项

- 请确保病历文件采用UTF-8编码
- 建议定期备份`data`目录下的数据
- 标注过程中避免关闭浏览器标签页
- 如需集成真实LLM，请在`app.py`中修改`standardize_actions_with_llm`函数

---

© 2025 正畸标注工具 - 让专家专注于核心逻辑判断

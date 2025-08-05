// 全局状态变量
let currentPatientId = null;
let patientIds = [];
let problemsData = [];
let solutionsData = [];
let annotationLinks = {}; // 结构: { solutionId: [problemId1, problemId2], ... }
let selectedSolutionId = null;

// 优化双击事件处理
let clickTimeout = null;
let isDoubleClick = false;

// DOM元素引用
const elements = {
    patientInfo: document.getElementById('patient-info'),
    patientSelector: document.getElementById('patient-selector'),
    prevButton: document.getElementById('prev-patient'),
    nextButton: document.getElementById('next-patient'),
    saveButton: document.getElementById('save-btn'),
    addActionBtn: document.getElementById('add-action-btn'),
    problemsContainer: document.getElementById('problems-container'),
    solutionsContainer: document.getElementById('solutions-container'),
    loading: document.getElementById('loading'),
    message: document.getElementById('message'),
    messageText: document.getElementById('message-text')
};

// 初始化应用
async function init() {
    try {
        showLoading(true);
        await loadPatientList();
        if (patientIds.length > 0) {
            await loadPatient(patientIds[0]);
        } else {
            showMessage('没有找到患者数据文件', 'error');
        }
    } catch (error) {
        console.error('初始化失败:', error);
        showMessage('初始化失败: ' + error.message, 'error');
    } finally {
        showLoading(false);
    }
}

// 加载患者列表
async function loadPatientList() {
    try {
        const response = await fetch('/api/patients');
        const data = await response.json();
        
        if (!response.ok) {
            throw new Error(data.error || '获取患者列表失败');
        }
        
        patientIds = data.patients;
        updatePatientSelector();
        updateNavigationButtons();
    } catch (error) {
        throw new Error('加载患者列表失败: ' + error.message);
    }
}

// 更新患者选择器
function updatePatientSelector() {
    elements.patientSelector.innerHTML = '<option value="">选择患者...</option>';
    patientIds.forEach(id => {
        const option = document.createElement('option');
        option.value = id;
        option.textContent = `患者 ${id}`;
        elements.patientSelector.appendChild(option);
    });
}

// 加载指定患者数据
async function loadPatient(patientId) {
    try {
        showLoading(true);
        
        const response = await fetch(`/api/patient/${patientId}`);
        const data = await response.json();
        
        if (!response.ok) {
            throw new Error(data.error || '获取患者数据失败');
        }
        
        // 更新全局状态
        currentPatientId = patientId;
        problemsData = data.problems;
        solutionsData = data.solutions;
        annotationLinks = data.annotations || {};
        selectedSolutionId = null;
        
        // 更新UI
        elements.patientInfo.textContent = `正畸标注工具 - 患者 ${patientId}`;
        elements.patientSelector.value = patientId;
        
        renderProblems();
        renderSolutions();
        updateNavigationButtons();
        
        console.log('患者数据加载完成:', data);
        
    } catch (error) {
        console.error('加载患者数据失败:', error);
        showMessage('加载患者数据失败: ' + error.message, 'error');
    } finally {
        showLoading(false);
    }
}

// 渲染问题列表
function renderProblems() {
    elements.problemsContainer.innerHTML = '';
    
    problemsData.forEach(problem => {
        const chip = document.createElement('div');
        chip.className = 'chip problem';
        chip.dataset.id = problem.id;
        chip.textContent = problem.text;
        chip.title = `类型: ${problem.type === 'examination' ? '检查发现' : '诊断'}`;
        
        // 检查是否与当前选中的方案有链接
        if (selectedSolutionId && annotationLinks[selectedSolutionId]?.includes(problem.id)) {
            chip.classList.add('linked');
        }
        
        chip.addEventListener('click', () => handleProblemClick(problem.id));
        elements.problemsContainer.appendChild(chip);
    });
}

// 渲染方案列表
function renderSolutions() {
    elements.solutionsContainer.innerHTML = '';
    
    solutionsData.forEach(solution => {
        const chip = document.createElement('div');
        chip.className = 'chip solution';
        chip.dataset.id = solution.id;
        chip.textContent = solution.text;
        chip.contentEditable = false;
        
        // 标记新建的动作
        if (solution.isNew) {
            chip.classList.add('new-action');
        }
        
        // 检查是否被选中
        if (selectedSolutionId === solution.id) {
            chip.classList.add('selected');
        }
        
        // 优化的点击和双击处理
        chip.addEventListener('mousedown', (e) => {
            e.preventDefault(); // 防止文本选择
        });
        
        chip.addEventListener('click', (e) => {
            e.stopPropagation();
            
            if (isDoubleClick) {
                isDoubleClick = false;
                return;
            }
            
            // 单击事件延迟执行，如果是双击则取消
            clickTimeout = setTimeout(() => {
                if (!isDoubleClick) {
                    handleSolutionClick(solution.id);
                }
            }, 250); // 250ms延迟
        });
        
        chip.addEventListener('dblclick', (e) => {
            e.preventDefault();
            e.stopPropagation();
            
            isDoubleClick = true;
            
            // 清除单击超时
            if (clickTimeout) {
                clearTimeout(clickTimeout);
                clickTimeout = null;
            }
            
            // 启用编辑模式
            enableEditing(chip, solution.id);
            
            // 重置双击标志
            setTimeout(() => {
                isDoubleClick = false;
            }, 300);
        });
        
        // 编辑完成事件
        chip.addEventListener('blur', () => {
            disableEditing(chip, solution.id);
        });
        
        chip.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                chip.blur();
            }
            // 添加删除功能：按Ctrl+Delete键删除动作
            if ((e.ctrlKey || e.metaKey) && e.key === 'Delete') {
                e.preventDefault();
                deleteAction(solution.id);
            }
            // ESC键取消编辑
            if (e.key === 'Escape') {
                // 恢复原始文本
                chip.textContent = solution.text;
                chip.blur();
            }
        });
        
        // 右键菜单：删除动作
        chip.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            if (confirm(`确定要删除动作"${solution.text}"吗？`)) {
                deleteAction(solution.id);
            }
        });
        
        elements.solutionsContainer.appendChild(chip);
    });
}

// 处理问题点击
function handleProblemClick(problemId) {
    if (!selectedSolutionId) {
        return; // 没有选中的方案，无法建立链接
    }
    
    // 初始化当前方案的链接数组
    if (!annotationLinks[selectedSolutionId]) {
        annotationLinks[selectedSolutionId] = [];
    }
    
    const links = annotationLinks[selectedSolutionId];
    const linkIndex = links.indexOf(problemId);
    
    if (linkIndex > -1) {
        // 已存在链接，移除它
        links.splice(linkIndex, 1);
    } else {
        // 不存在链接，添加它
        links.push(problemId);
    }
    
    // 重新渲染问题以更新高亮状态
    renderProblems();
    
    console.log('更新链接:', selectedSolutionId, '→', annotationLinks[selectedSolutionId]);
}

// 处理方案点击
function handleSolutionClick(solutionId) {
    if (selectedSolutionId === solutionId) {
        // 取消选择
        selectedSolutionId = null;
    } else {
        // 选择新方案
        selectedSolutionId = solutionId;
    }
    
    // 重新渲染以更新高亮状态
    renderProblems();
    renderSolutions();
    
    console.log('选中方案:', selectedSolutionId);
}

// 启用编辑模式
function enableEditing(chip, solutionId) {
    // 防止重复启用编辑模式
    if (chip.contentEditable === 'true') {
        return;
    }
    
    chip.classList.add('editable');
    chip.contentEditable = true;
    
    // 聚焦并选中所有文本
    chip.focus();
    
    // 选中所有文本
    setTimeout(() => {
        const range = document.createRange();
        range.selectNodeContents(chip);
        const selection = window.getSelection();
        selection.removeAllRanges();
        selection.addRange(range);
    }, 10);
    
    console.log('编辑模式已启用:', solutionId);
}

// 禁用编辑模式
function disableEditing(chip, solutionId) {
    // 检查是否真的在编辑模式
    if (chip.contentEditable !== 'true') {
        return;
    }
    
    chip.classList.remove('editable');
    chip.contentEditable = false;
    
    // 清除选择
    window.getSelection().removeAllRanges();
    
    // 更新数据
    const newText = chip.textContent.trim();
    const solution = solutionsData.find(s => s.id === solutionId);
    if (solution) {
        if (newText === '' || newText === '新建动作') {
            // 如果文本为空，恢复原始文本
            chip.textContent = solution.text;
            showMessage('动作文本不能为空', 'error');
        } else {
            solution.text = newText;
            solution.isNew = false; // 移除新建标记
            console.log('方案文本已更新:', solutionId, '→', newText);
            chip.classList.remove('new-action');
        }
    }
}

// 新建动作功能
function addNewAction() {
    const newActionId = `action-${solutionsData.length}`;
    const newAction = {
        id: newActionId,
        text: "新建动作",
        isNew: true
    };
    
    solutionsData.push(newAction);
    renderSolutions();
    
    // 自动进入编辑模式
    const newChip = document.querySelector(`[data-id="${newActionId}"]`);
    if (newChip) {
        setTimeout(() => {
            enableEditing(newChip, newActionId);
        }, 100);
    }
}

// 删除动作功能
function deleteAction(actionId) {
    if (!confirm('确定要删除这个动作吗？')) {
        return;
    }
    
    const index = solutionsData.findIndex(s => s.id === actionId);
    if (index > -1) {
        // 删除相关标注链接
        delete annotationLinks[actionId];
        
        // 删除动作
        solutionsData.splice(index, 1);
        
        // 如果删除的是当前选中的动作，清除选择
        if (selectedSolutionId === actionId) {
            selectedSolutionId = null;
        }
        
        renderSolutions();
        renderProblems();
        
        console.log('动作已删除:', actionId);
    }
}

// 保存标注
async function saveAnnotations() {
    if (!currentPatientId) {
        showMessage('没有选择患者', 'error');
        return;
    }
    
    try {
        showLoading(true);
        
        const payload = {
            annotations: annotationLinks,
            solutions: solutionsData
        };
        
        const response = await fetch(`/api/save/${currentPatientId}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload)
        });
        
        const data = await response.json();
        
        if (!response.ok) {
            throw new Error(data.error || '保存失败');
        }
        
        showMessage('保存成功!', 'success');
        console.log('保存完成:', data);
        
    } catch (error) {
        console.error('保存失败:', error);
        showMessage('保存失败: ' + error.message, 'error');
    } finally {
        showLoading(false);
    }
}

// 导航到上一个患者
function navigateToPreviousPatient() {
    const currentIndex = patientIds.indexOf(currentPatientId);
    if (currentIndex > 0) {
        loadPatient(patientIds[currentIndex - 1]);
    }
}

// 导航到下一个患者
function navigateToNextPatient() {
    const currentIndex = patientIds.indexOf(currentPatientId);
    if (currentIndex < patientIds.length - 1) {
        loadPatient(patientIds[currentIndex + 1]);
    }
}

// 更新导航按钮状态
function updateNavigationButtons() {
    const currentIndex = patientIds.indexOf(currentPatientId);
    elements.prevButton.disabled = currentIndex <= 0;
    elements.nextButton.disabled = currentIndex >= patientIds.length - 1;
}

// 显示/隐藏加载状态
function showLoading(show) {
    if (show) {
        elements.loading.classList.remove('hidden');
    } else {
        elements.loading.classList.add('hidden');
    }
}

// 显示消息
function showMessage(text, type = 'info') {
    elements.messageText.textContent = text;
    elements.message.className = `message ${type}`;
    elements.message.classList.remove('hidden');
    
    // 3秒后自动隐藏
    setTimeout(() => {
        elements.message.classList.add('hidden');
    }, 3000);
}

// 事件监听器设置
function setupEventListeners() {
    // 导航按钮
    elements.prevButton.addEventListener('click', navigateToPreviousPatient);
    elements.nextButton.addEventListener('click', navigateToNextPatient);
    
    // 患者选择器
    elements.patientSelector.addEventListener('change', (e) => {
        if (e.target.value) {
            loadPatient(e.target.value);
        }
    });
    
    // 保存按钮
    elements.saveButton.addEventListener('click', saveAnnotations);
    
    // 新建动作按钮
    elements.addActionBtn.addEventListener('click', addNewAction);
    
    // 键盘快捷键
    document.addEventListener('keydown', (e) => {
        if (e.ctrlKey || e.metaKey) {
            switch (e.key) {
                case 's':
                    e.preventDefault();
                    saveAnnotations();
                    break;
                case 'ArrowLeft':
                    e.preventDefault();
                    navigateToPreviousPatient();
                    break;
                case 'ArrowRight':
                    e.preventDefault();
                    navigateToNextPatient();
                    break;
            }
        }
    });
    
    // 点击消息框隐藏
    elements.message.addEventListener('click', () => {
        elements.message.classList.add('hidden');
    });
}

// 页面加载完成后初始化
document.addEventListener('DOMContentLoaded', () => {
    setupEventListeners();
    init();
});

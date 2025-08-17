// 全局状态变量
let currentPatientId = null;
let patientIds = [];
let problemsData = [];
let solutionsData = [];
let annotationLinks = {}; // 结构: { solutionId: [problemId1, problemId2], ... }
let selectedSolutionId = null;

// 缓存机制
const patientCache = new Map();
const CACHE_EXPIRY = 5 * 60 * 1000; // 5分钟缓存

// 优化双击事件处理
let clickTimeout = null;
let isDoubleClick = false;

// 重试机制配置
const RETRY_CONFIG = {
    maxRetries: 3,
    retryDelay: 1000, // 1秒
    backoffMultiplier: 2
};

// DOM元素引用
const elements = {
    patientInfo: document.getElementById('patient-info'),
    patientSelector: document.getElementById('patient-selector'),
    prevButton: document.getElementById('prev-patient'),
    nextButton: document.getElementById('next-patient'),
    saveButton: document.getElementById('save-btn'),
    addActionBtn: document.getElementById('add-action-btn'),
    regenerateActionsBtn: document.getElementById('regenerate-actions-btn'),
    useStreamCheckbox: document.getElementById('use-stream'),
    expandPlanBtn: document.getElementById('expand-plan-btn'),
    problemsContainer: document.getElementById('problems-container'),
    solutionsContainer: document.getElementById('solutions-container'),
    originalPlanContent: document.getElementById('original-plan-content'),
    planModal: document.getElementById('plan-modal'),
    modalPlanContent: document.getElementById('modal-plan-content'),
    closeModalBtn: document.getElementById('close-modal-btn'),
    closeModalFooterBtn: document.getElementById('close-modal-footer-btn'),
    copyPlanBtn: document.getElementById('copy-plan-btn'),
    loading: document.getElementById('loading'),
    message: document.getElementById('message'),
    messageText: document.getElementById('message-text')
};

// 网络请求重试机制
async function fetchWithRetry(url, options = {}, retries = RETRY_CONFIG.maxRetries) {
    try {
        const response = await fetch(url, options);
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        return response;
    } catch (error) {
        if (retries > 0) {
            console.log(`请求失败，剩余重试次数: ${retries - 1}`, error.message);
            await new Promise(resolve => setTimeout(resolve, RETRY_CONFIG.retryDelay));
            return fetchWithRetry(url, options, retries - 1);
        }
        throw error;
    }
}

// 缓存管理
function getCachedPatient(patientId) {
    const cached = patientCache.get(patientId);
    if (cached && Date.now() - cached.timestamp < CACHE_EXPIRY) {
        return cached.data;
    }
    return null;
}

function setCachedPatient(patientId, data) {
    patientCache.set(patientId, {
        data: data,
        timestamp: Date.now()
    });
}

function clearPatientCache() {
    patientCache.clear();
}

// 初始化应用
async function init() {
    try {
        showLoading(true);
        await loadPatientList();
        if (patientIds.length > 0) {
            // 获取最近编辑的患者ID
            const lastEditedPatient = await getLastEditedPatient();
            const patientToLoad = lastEditedPatient || patientIds[0];
            
            // 智能选择加载方式：如果是最近编辑的患者，使用常规加载；如果是新患者且开启流式，使用流式加载
            const useStream = elements.useStreamCheckbox.checked && !lastEditedPatient;
            await loadPatient(patientToLoad, useStream);
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

// 获取最近编辑的患者
async function getLastEditedPatient() {
    try {
        const response = await fetch('/api/last-edited-patient');
        if (response.ok) {
            const data = await response.json();
            return data.patient_id;
        }
    } catch (error) {
        console.log('获取最近编辑患者失败，使用默认患者');
    }
    return null;
}

// 加载患者列表
async function loadPatientList() {
    try {
        const response = await fetchWithRetry('/api/patients');
        const data = await response.json();
        
        patientIds = data.patients;
        updatePatientSelector();
        updateNavigationButtons();
        
        console.log(`成功加载 ${patientIds.length} 个患者`);
    } catch (error) {
        console.error('加载患者列表失败:', error);
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
async function loadPatient(patientId, useStream = false, forceRegenerate = false) {
    try {
        showLoading(true);
        
        // 如果不是强制重新生成，检查缓存
        if (!forceRegenerate) {
            const cachedData = getCachedPatient(patientId);
            if (cachedData) {
                console.log(`从缓存加载患者 ${patientId}`);
                await loadPatientDirectly(cachedData);
                return;
            }
        }
        
        // 首先检查患者是否有已保存的数据
        const url = forceRegenerate ? 
            `/api/patient/${patientId}?force_regenerate=true` : 
            `/api/patient/${patientId}`;
        const response = await fetchWithRetry(url);
        const data = await response.json();
        
        // 如果不是强制重新生成，缓存数据
        if (!forceRegenerate) {
            setCachedPatient(patientId, data);
        }
        
        // 如果有已保存的数据且不是强制重新生成，直接使用，不使用流式加载
        if (data.has_saved_data && !forceRegenerate) {
            console.log(`患者 ${patientId} 有已保存数据，直接加载`);
            await loadPatientDirectly(data);
            return;
        }
        
        // 如果没有已保存数据或者强制重新生成，且使用流式加载
        if (useStream) {
            const actionType = forceRegenerate ? '重新生成' : '生成';
            console.log(`患者 ${patientId} ${actionType}，使用流式生成`);
            await loadPatientWithStream(patientId);
            return;
        }
        
        // 否则使用常规加载（会触发LLM调用和自动保存）
        const actionType = forceRegenerate ? '重新生成' : '生成';
        console.log(`患者 ${patientId} ${actionType}，使用常规加载`);
        await loadPatientDirectly(data);
        
    } catch (error) {
        console.error('加载患者数据失败:', error);
        showMessage('加载患者数据失败: ' + error.message, 'error');
    } finally {
        showLoading(false);
    }
}

// 性能监控
const PerformanceMonitor = {
    startTime: null,
    
    start(operation) {
        this.startTime = performance.now();
        console.log(`开始执行: ${operation}`);
    },
    
    end(operation) {
        if (this.startTime) {
            const duration = performance.now() - this.startTime;
            console.log(`完成执行: ${operation}, 耗时: ${duration.toFixed(2)}ms`);
            this.startTime = null;
            return duration;
        }
    }
};

// 错误日志收集
const ErrorLogger = {
    errors: [],
    
    log(error, context = '') {
        const errorInfo = {
            message: error.message,
            stack: error.stack,
            context: context,
            timestamp: new Date().toISOString(),
            url: window.location.href,
            userAgent: navigator.userAgent
        };
        
        this.errors.push(errorInfo);
        console.error('错误记录:', errorInfo);
        
        // 保持最近50个错误
        if (this.errors.length > 50) {
            this.errors.shift();
        }
    },
    
    getErrors() {
        return this.errors;
    },
    
    clearErrors() {
        this.errors = [];
    }
};

// 直接加载患者数据（用于有已保存数据的情况）
async function loadPatientDirectly(data) {
    // 更新全局状态
    currentPatientId = data.patient_id;
    problemsData = data.problems;
    solutionsData = data.solutions;
    annotationLinks = data.annotations || {};
    selectedSolutionId = null;
    
    // 更新UI
    elements.patientInfo.textContent = `正畸标注工具 - 患者 ${data.patient_id}`;
    elements.patientSelector.value = data.patient_id;
    
    renderProblems();
    renderSolutions();
    renderOriginalPlan(data.original_treatment_plan || '');
    
    // 默认选择第一个动作
    if (solutionsData.length > 0) {
        selectedSolutionId = solutionsData[0].id;
        // 重新渲染以应用选择状态
        renderSolutions();
        renderProblems();
    }
    
    updateNavigationButtons();
    
    console.log('患者数据加载完成:', data);
}

// 流式加载患者数据
async function loadPatientWithStream(patientId) {
    try {
        // 先获取基本的患者信息（问题列表等）
        const response = await fetch(`/api/patient/${patientId}`);
        const data = await response.json();
        
        if (!response.ok) {
            throw new Error(data.error || '获取患者数据失败');
        }
        
        // 更新基本信息
        currentPatientId = patientId;
        problemsData = data.problems;
        annotationLinks = data.annotations || {};
        selectedSolutionId = null;
        solutionsData = []; // 清空，准备流式加载
        
        // 更新UI
        elements.patientInfo.textContent = `正畸标注工具 - 患者 ${patientId}`;
        elements.patientSelector.value = patientId;
        
        renderProblems();
        renderOriginalPlan(data.original_treatment_plan || '');
        
        // 显示流式加载状态
        showStreamingActions();
        
        // 开始流式获取诊疗动作
        const eventSource = new EventSource(`/api/patient/${patientId}/stream-actions`);
        
        eventSource.onmessage = function(event) {
            const data = JSON.parse(event.data);
            
            switch(data.type) {
                case 'start':
                    console.log('开始生成诊疗动作...');
                    break;
                
                case 'action':
                    // 添加新动作到列表
                    const newAction = {
                        id: `action-${solutionsData.length}`,
                        text: data.text
                    };
                    solutionsData.push(newAction);
                    
                    // 动态添加到UI
                    addActionToUI(newAction, true); // true表示动画效果
                    break;
                
                case 'complete':
                    // 完成时更新最终的动作列表
                    solutionsData = data.actions.map((text, index) => ({
                        id: `action-${index}`,
                        text: text
                    }));
                    
                    // 重新渲染完整列表
                    renderSolutions();
                    
                    // 默认选择第一个动作
                    if (solutionsData.length > 0) {
                        selectedSolutionId = solutionsData[0].id;
                        renderSolutions();
                        renderProblems();
                    }
                    
                    hideStreamingActions();
                    eventSource.close();
                    
                    // 显示自动保存消息
                    if (data.auto_saved) {
                        showMessage('诊疗动作生成完成并已自动保存', 'success');
                    }
                    
                    console.log('诊疗动作生成完成');
                    break;
                
                case 'error':
                    showMessage('生成诊疗动作时出错: ' + data.message, 'error');
                    hideStreamingActions();
                    eventSource.close();
                    break;
            }
        };
        
        eventSource.onerror = function(event) {
            console.error('EventSource 错误:', event);
            showMessage('连接中断，请重试', 'error');
            hideStreamingActions();
            eventSource.close();
        };
        
        updateNavigationButtons();
        
    } catch (error) {
        console.error('流式加载患者数据失败:', error);
        showMessage('加载患者数据失败: ' + error.message, 'error');
        hideStreamingActions();
    }
}

// 显示流式加载状态
function showStreamingActions() {
    elements.solutionsContainer.innerHTML = '<div class="streaming-message">正在智能分析诊疗方案...</div>';
    showLoading(false); // 隐藏普通的加载提示
}

// 隐藏流式加载状态
function hideStreamingActions() {
    const streamingMsg = elements.solutionsContainer.querySelector('.streaming-message');
    if (streamingMsg) {
        streamingMsg.remove();
    }
}

// 动态添加动作到UI
function addActionToUI(action, animated = false) {
    // 移除流式消息（如果存在）
    const streamingMsg = elements.solutionsContainer.querySelector('.streaming-message');
    if (streamingMsg) {
        streamingMsg.remove();
    }
    
    const chip = createSolutionChip(action);
    
    if (animated) {
        // 添加进入动画
        chip.style.opacity = '0';
        chip.style.transform = 'translateY(20px)';
        chip.classList.add('streaming-action');
        
        elements.solutionsContainer.appendChild(chip);
        
        // 触发动画
        setTimeout(() => {
            chip.style.transition = 'opacity 0.5s ease, transform 0.5s ease';
            chip.style.opacity = '1';
            chip.style.transform = 'translateY(0)';
        }, 50);
    } else {
        elements.solutionsContainer.appendChild(chip);
    }
}

// 创建解决方案芯片
function createSolutionChip(solution) {
    const chipContainer = document.createElement('div');
    chipContainer.className = 'chip-container-item';
    chipContainer.dataset.id = solution.id;
    
    const chip = document.createElement('div');
    chip.className = 'chip solution-chip';
    chip.dataset.id = solution.id;
    chip.textContent = solution.text;
    
    // 添加选中状态
    if (selectedSolutionId === solution.id) {
        chip.classList.add('selected');
    }
    
    // 添加关联状态
    if (annotationLinks[solution.id] && annotationLinks[solution.id].length > 0) {
        chip.classList.add('linked');
    }
    
    // 如果是新动作，添加特殊样式
    if (solution.isNew) {
        chip.classList.add('new-action');
    }
    
    // 添加点击事件
    chip.addEventListener('click', (e) => {
        if (clickTimeout) {
            clearTimeout(clickTimeout);
            clickTimeout = null;
            isDoubleClick = true;
            
            // 双击事件：进入编辑模式
            enableEditing(chip, solution.id);
        } else {
            clickTimeout = setTimeout(() => {
                if (!isDoubleClick) {
                    // 单击事件：选择动作
                    selectSolution(solution.id);
                }
                isDoubleClick = false;
                clickTimeout = null;
            }, 250);
        }
    });
    
    // 添加删除按钮
    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'delete-btn';
    deleteBtn.innerHTML = '×';
    deleteBtn.title = '删除动作';
    deleteBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        deleteAction(solution.id);
    });
    
    chipContainer.appendChild(chip);
    chipContainer.appendChild(deleteBtn);
    
    return chipContainer;
}

// 渲染问题列表（按类型分组）
function renderProblems() {
    elements.problemsContainer.innerHTML = '';
    
    // 按类型分组
    const problemsByType = {};
    problemsData.forEach(problem => {
        const type = problem.type || '其他';
        if (!problemsByType[type]) {
            problemsByType[type] = [];
        }
        problemsByType[type].push(problem);
    });
    
    // 定义类型排序顺序
    const typeOrder = ['主诉', '牙性', '牙齿', '骨性', '软组织', '功能', '生长发育', '不良习惯', '其他'];
    
    // 按顺序渲染每个类型
    typeOrder.forEach(type => {
        if (problemsByType[type]) {
            // 创建类型标题
            const typeHeader = document.createElement('div');
            typeHeader.className = 'problem-type-header';
            typeHeader.textContent = type;
            elements.problemsContainer.appendChild(typeHeader);
            
            // 创建该类型的问题容器
            const typeContainer = document.createElement('div');
            typeContainer.className = 'problem-type-container';
            
            problemsByType[type].forEach(problem => {
                const chip = document.createElement('div');
                chip.className = 'chip problem';
                chip.dataset.id = problem.id;
                chip.textContent = problem.text;
                chip.title = `类型: ${type}`;
                
                // 检查是否与当前选中的方案有链接
                if (selectedSolutionId && annotationLinks[selectedSolutionId]?.includes(problem.id)) {
                    chip.classList.add('linked');
                }
                
                chip.addEventListener('click', () => handleProblemClick(problem.id));
                typeContainer.appendChild(chip);
            });
            
            elements.problemsContainer.appendChild(typeContainer);
        }
    });
}

// 渲染原始诊疗方案
function renderOriginalPlan(originalText) {
    if (elements.originalPlanContent) {
        if (originalText && originalText.trim()) {
            const displayText = originalText.trim();
            elements.originalPlanContent.textContent = displayText;
            
            // 同时更新模态框内容，进行格式化
            if (elements.modalPlanContent) {
                const formattedText = formatPlanContent(displayText);
                elements.modalPlanContent.innerHTML = formattedText;
            }
        } else {
            elements.originalPlanContent.textContent = '暂无原始诊疗方案数据';
            elements.originalPlanContent.style.fontStyle = 'italic';
            elements.originalPlanContent.style.color = '#999';
            
            if (elements.modalPlanContent) {
                elements.modalPlanContent.innerHTML = '<em style="color: #999;">暂无原始诊疗方案数据</em>';
            }
        }
    }
}

// 格式化诊疗方案内容
function formatPlanContent(text) {
    if (!text) return '';
    
    // 将文本按行分割并格式化
    const lines = text.split('\n');
    let formattedLines = [];
    
    lines.forEach((line, index) => {
        line = line.trim();
        if (!line) {
            formattedLines.push('<br>');
            return;
        }
        
        // 检测是否为步骤（以数字开头）
        if (/^\d+\.\s/.test(line)) {
            formattedLines.push(`<div class="plan-step"><strong>${line}</strong></div>`);
        }
        // 检测是否为要点（以-或•开头）
        else if (/^[-•]\s/.test(line)) {
            formattedLines.push(`<div class="plan-point">${line}</div>`);
        }
        // 检测是否为标题（包含"目标"、"步骤"、"费用"等关键词）
        else if (/目标|步骤|费用|风险|时间|注意/.test(line)) {
            formattedLines.push(`<div class="plan-header">${line}</div>`);
        }
        // 普通文本
        else {
            formattedLines.push(`<div class="plan-text">${line}</div>`);
        }
    });
    
    return formattedLines.join('');
}

// 显示模态框
function showPlanModal() {
    if (elements.planModal) {
        elements.planModal.classList.remove('hidden');
        // 使用setTimeout确保类添加在下一个渲染周期
        setTimeout(() => {
            elements.planModal.classList.add('show');
        }, 10);
        
        // 防止背景滚动
        document.body.style.overflow = 'hidden';
    }
}

// 隐藏模态框
function hidePlanModal() {
    if (elements.planModal) {
        elements.planModal.classList.remove('show');
        // 等待动画完成后隐藏
        setTimeout(() => {
            elements.planModal.classList.add('hidden');
            document.body.style.overflow = '';
        }, 300);
    }
}

// 复制内容到剪贴板
async function copyPlanToClipboard() {
    try {
        // 获取原始文本内容（而不是HTML）
        const originalText = elements.originalPlanContent.textContent || '';
        
        if (navigator.clipboard && window.isSecureContext) {
            await navigator.clipboard.writeText(originalText);
        } else {
            // 备用方案：使用传统的复制方法
            const textArea = document.createElement('textarea');
            textArea.value = originalText;
            textArea.style.position = 'fixed';
            textArea.style.left = '-999999px';
            textArea.style.top = '-999999px';
            document.body.appendChild(textArea);
            textArea.focus();
            textArea.select();
            document.execCommand('copy');
            textArea.remove();
        }
        
        showMessage('内容已复制到剪贴板', 'success');
        
        // 复制成功后，给按钮一个视觉反馈
        if (elements.copyPlanBtn) {
            const originalText = elements.copyPlanBtn.textContent;
            elements.copyPlanBtn.textContent = '已复制!';
            elements.copyPlanBtn.style.background = '#28a745';
            
            setTimeout(() => {
                elements.copyPlanBtn.textContent = originalText;
                elements.copyPlanBtn.style.background = '#007bff';
            }, 1500);
        }
        
    } catch (err) {
        console.error('复制失败:', err);
        showMessage('复制失败，请手动选择复制', 'error');
    }
}

// 渲染方案列表
function renderSolutions() {
    elements.solutionsContainer.innerHTML = '';
    
    solutionsData.forEach(solution => {
        // 创建动作容器
        const chipContainer = document.createElement('div');
        chipContainer.className = 'solution-item';
        
        const chip = document.createElement('div');
        chip.className = 'chip solution';
        chip.dataset.id = solution.id;
        chip.textContent = solution.text;
        chip.contentEditable = false;
        
        // 创建删除按钮
        const deleteBtn = document.createElement('button');
        deleteBtn.className = 'delete-btn';
        deleteBtn.innerHTML = '×';
        deleteBtn.title = '删除动作';
        deleteBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            if (confirm(`确定要删除动作"${solution.text}"吗？`)) {
                deleteAction(solution.id);
            }
        });
        
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
        
        // 组装容器
        chipContainer.appendChild(chip);
        chipContainer.appendChild(deleteBtn);
        elements.solutionsContainer.appendChild(chipContainer);
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

// 重新抽取诊疗动作功能
async function regenerateActions() {
    if (!currentPatientId) {
        showMessage('请先选择患者', 'warning');
        return;
    }

    // 确认对话框
    if (!confirm('确定要重新抽取诊疗动作吗？这将覆盖当前的动作内容。')) {
        return;
    }

    try {
        // 禁用按钮防止重复点击
        elements.regenerateActionsBtn.disabled = true;
        elements.regenerateActionsBtn.textContent = '抽取中...';

        // 先保存当前状态
        await saveAnnotations(true);

        // 清空缓存，强制重新生成
        patientCache.delete(currentPatientId);

        // 重新加载患者数据并强制调用LLM
        const useStream = elements.useStreamCheckbox.checked;
        await loadPatient(currentPatientId, useStream, true); // 第三个参数表示强制重新生成

        showMessage('诊疗动作重新抽取完成', 'success');

    } catch (error) {
        console.error('重新抽取失败:', error);
        showMessage('重新抽取失败: ' + error.message, 'error');
    } finally {
        // 恢复按钮状态
        elements.regenerateActionsBtn.disabled = false;
        elements.regenerateActionsBtn.textContent = '🔄 重新抽取';
    }
}

// 删除动作功能
async function deleteAction(actionId) {
    if (!confirm('确定要删除这个动作吗？')) {
        return;
    }
    
    try {
        // 调用后端API删除动作
        const response = await fetch(`/api/action/delete/${currentPatientId}/${actionId}`, {
            method: 'DELETE'
        });
        
        const data = await response.json();
        
        if (!response.ok) {
            throw new Error(data.error || '删除动作失败');
        }
        
        // 从本地数据中删除
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
            
            showMessage('动作删除成功', 'success');
            console.log('动作已删除:', actionId);
        }
    } catch (error) {
        console.error('删除动作失败:', error);
        showMessage('删除动作失败: ' + error.message, 'error');
    }
}

// 保存标注
async function saveAnnotations(silent = false) {
    if (!currentPatientId) {
        if (!silent) showMessage('没有选择患者', 'error');
        return;
    }
    
    try {
        if (!silent) {
            showLoading(true);
            PerformanceMonitor.start('保存标注');
        }
        
        const payload = {
            annotations: annotationLinks,
            solutions: solutionsData
        };
        
        const response = await fetchWithRetry(`/api/save/${currentPatientId}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload)
        });
        
        const data = await response.json();
        
        // 清除该患者的缓存，强制下次重新加载
        patientCache.delete(currentPatientId);
        
        if (!silent) {
            showMessage('保存成功!', 'success');
            PerformanceMonitor.end('保存标注');
        }
        
        console.log('保存完成:', data);
        
    } catch (error) {
        ErrorLogger.log(error, '保存标注时出错');
        console.error('保存失败:', error);
        
        if (!silent) {
            showMessage('保存失败: ' + error.message, 'error');
        }
        
        // 将数据存储到本地存储作为备份
        try {
            const backup = {
                patientId: currentPatientId,
                annotations: annotationLinks,
                solutions: solutionsData,
                timestamp: Date.now()
            };
            localStorage.setItem(`backup_${currentPatientId}`, JSON.stringify(backup));
            if (!silent) {
                showMessage('数据已备份到本地', 'info');
            }
        } catch (backupError) {
            console.error('本地备份失败:', backupError);
        }
        
    } finally {
        if (!silent) showLoading(false);
    }
}

// 导航到上一个患者
async function navigateToPreviousPatient() {
    const currentIndex = patientIds.indexOf(currentPatientId);
    if (currentIndex > 0) {
        // 自动保存当前患者
        await saveAnnotations(true); // 传入true表示静默保存
        const useStream = elements.useStreamCheckbox.checked;
        await loadPatient(patientIds[currentIndex - 1], useStream);
    }
}

// 导航到下一个患者
async function navigateToNextPatient() {
    const currentIndex = patientIds.indexOf(currentPatientId);
    if (currentIndex < patientIds.length - 1) {
        // 自动保存当前患者
        await saveAnnotations(true); // 传入true表示静默保存
        const useStream = elements.useStreamCheckbox.checked;
        await loadPatient(patientIds[currentIndex + 1], useStream);
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
    elements.patientSelector.addEventListener('change', async (e) => {
        if (e.target.value && e.target.value !== currentPatientId) {
            // 自动保存当前患者
            if (currentPatientId) {
                await saveAnnotations(true); // 静默保存
            }
            const useStream = elements.useStreamCheckbox.checked;
            await loadPatient(e.target.value, useStream);
        }
    });
    
    // 保存按钮
    elements.saveButton.addEventListener('click', saveAnnotations);
    
    // 新建动作按钮
    elements.addActionBtn.addEventListener('click', addNewAction);
    
    // 重新抽取按钮
    elements.regenerateActionsBtn.addEventListener('click', regenerateActions);
    
    // 模态框相关事件
    if (elements.expandPlanBtn) {
        elements.expandPlanBtn.addEventListener('click', showPlanModal);
    }
    
    if (elements.originalPlanContent) {
        elements.originalPlanContent.addEventListener('click', showPlanModal);
    }
    
    if (elements.closeModalBtn) {
        elements.closeModalBtn.addEventListener('click', hidePlanModal);
    }
    
    if (elements.closeModalFooterBtn) {
        elements.closeModalFooterBtn.addEventListener('click', hidePlanModal);
    }
    
    if (elements.copyPlanBtn) {
        elements.copyPlanBtn.addEventListener('click', copyPlanToClipboard);
    }
    
    // 点击模态框背景关闭
    if (elements.planModal) {
        elements.planModal.addEventListener('click', (e) => {
            if (e.target === elements.planModal) {
                hidePlanModal();
            }
        });
    }
    
    // ESC键关闭模态框
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && elements.planModal && !elements.planModal.classList.contains('hidden')) {
            hidePlanModal();
        }
    });
    
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

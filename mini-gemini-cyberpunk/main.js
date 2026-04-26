

const MODELS_LIST = [
  "gemini-1.5-flash", "gemini-2.0-flash", "gemini-1.5-pro", 
  "gemini-2.5-flash", "gemini-2.5-flash-lite", "gemini-3.1-flash-lite", "gemini-3.1-flash"
];

const SYSTEM_PROMPT = `Eres MINI GEMINI AI MASTER V15.2, diseñada por el Ing. Justin Sebastian
ERES UN ANALISTA DE DATOS SENIOR Y ARQUITECTO VISUAL.

REGLAS DE FORMATO DE TEXTO (CRÍTICO):
1. ESTRUCTURA: Usa siempre Títulos (##) y Subtítulos (###).
2. RESALTADO: Aplica negritas (**palabra**) a términos clave.
3. DATOS: Aplica SIEMPRE formato de código (\`valor\`) a números y porcentajes.
4. GRÁFICOS: Si detectas datos numéricos, genera un bloque [CHART_DATA: {...}] con formato JSON para Chart.js.
5. ESTILO: Cyberpunk neón vibrante.`;

// --- CONFIGURACIÓN DE API KEY ---
let rawKey = import.meta.env?.VITE_GEMINI_API_KEY || localStorage.getItem("GEMINI_PRO_KEY") || "";
let API_KEY = rawKey.trim();

// --- MEMORIA Y ESTADO ---
let globalHistory = [];
try { globalHistory = JSON.parse(localStorage.getItem('cyberpunk_history_v15')) || []; } catch(e) { globalHistory = []; }
let currentSessionStartIndex = globalHistory.length; 

let uploadedFilesData = [];
let selectedModel = localStorage.getItem("selectedGeminiModel") || MODELS_LIST[0];
let isAudioEnabled = true; 

// --- REFERENCIAS AL DOM (ADAPTADAS A TU HTML) ---
const chatContainer   = document.getElementById('chat-container');
const userInput       = document.getElementById('user-input');
const sendBtn         = document.getElementById('send-btn');
const modelStatus     = document.getElementById('current-model-name');
const clearChatBtn    = document.getElementById('clear-chat');
const sidebar         = document.getElementById('sidebar');
const toggleSidebarBtn= document.getElementById('toggle-sidebar');
const closeSidebarBtn = document.getElementById('close-sidebar');
const fileInput       = document.getElementById('file-input');
const voiceBtn        = document.getElementById('voice-btn');

// ====================== FUNCIÓN PRINCIPAL DE ENVÍO ======================

async function handleSendMessage() {
    const text = userInput.value.trim();
    if (!text && uploadedFilesData.length === 0) return;

    // Eliminar pantalla de bienvenida si existe
    const welcome = document.querySelector('.welcome-screen');
    if (welcome) welcome.remove();

    // 1. Mostrar mensaje del usuario
    appendMessage('user', text);
    userInput.value = '';
    ajustarInput();

    // 2. Crear burbuja de carga para la IA
    const botMsgDiv = appendMessage('bot', '<i class="fas fa-spinner fa-spin"></i> Procesando red neuronal...');

    try {
        // 3. Llamar a la API de Google Gemini
        const response = await executeModelFallback(text);
        const aiText = response.candidates[0].content.parts[0].text;

        // 4. Procesar Texto (Markdown + Gráficos)
        const { html, charts } = procesarEstructuraVisual(aiText);
        
        // 5. Actualizar interfaz
        botMsgDiv.innerHTML = `<div class="ai-content">${html}</div>`;
        
        // 6. Renderizar gráficos si vienen en la respuesta
        charts.forEach(chartObj => {
            const canvasContainer = document.createElement('div');
            canvasContainer.className = "cyber-chart-wrapper my-3";
            canvasContainer.style.background = "rgba(0,0,0,0.3)";
            canvasContainer.style.padding = "15px";
            canvasContainer.style.borderRadius = "10px";
            canvasContainer.innerHTML = `<canvas id="${chartObj.id}"></canvas>`;
            botMsgDiv.appendChild(canvasContainer);
            
            new Chart(document.getElementById(chartObj.id), chartObj.config);
        });

        // 7. Guardar historial
        globalHistory.push({ role: 'user', text: text });
        globalHistory.push({ role: 'model', text: aiText });
        localStorage.setItem('cyberpunk_history_v15', JSON.stringify(globalHistory));

        // 8. Resaltar sintaxis de código (Prism)
        if (window.Prism) Prism.highlightAllUnder(botMsgDiv);

        // 9. Audio
        if (isAudioEnabled) speak(aiText);

    } catch (error) {
        console.error(error);
        botMsgDiv.innerHTML = `<span class="text-danger"><i class="fas fa-exclamation-triangle"></i> ERROR: ${error.message}</span>`;
    }
}

// ====================== UTILIDADES DE INTERFAZ ======================

function appendMessage(role, content) {
    const msgDiv = document.createElement('div');
    msgDiv.className = `cyber-message ${role}-message mb-4 animate__animated animate__fadeInUp`;
    
    // Estilo básico para diferenciar burbujas
    const bg = role === 'user' ? 'rgba(0, 255, 242, 0.1)' : 'rgba(157, 0, 255, 0.1)';
    const border = role === 'user' ? '#00fff2' : '#9d00ff';
    
    msgDiv.style.cssText = `
        padding: 15px;
        border-left: 4px solid ${border};
        background: ${bg};
        border-radius: 0 10px 10px 0;
        color: #e0e0e0;
        max-width: 85%;
        ${role === 'user' ? 'margin-left: auto;' : 'margin-right: auto;'}
    `;

    msgDiv.innerHTML = content;
    chatContainer.appendChild(msgDiv);
    chatContainer.scrollTop = chatContainer.scrollHeight;
    return msgDiv;
}

function ajustarInput() {
    userInput.style.height = 'auto';
    userInput.style.height = (userInput.scrollHeight) + 'px';
}

function procesarEstructuraVisual(text) {
    let processedText = text;
    let extractedConfigs = [];
    
    // Extraer JSON de gráficos
    const TAG = '[CHART_DATA:';
    while (processedText.includes(TAG)) {
        let tagIndex = processedText.indexOf(TAG);
        let jsonStart = processedText.indexOf('{', tagIndex);
        let depth = 0, jsonEnd = -1;

        for (let i = jsonStart; i < processedText.length; i++) {
            if (processedText[i] === '{') depth++;
            else if (processedText[i] === '}') {
                depth--;
                if (depth === 0) { jsonEnd = i; break; }
            }
        }

        if (jsonEnd !== -1) {
            let closingBracket = processedText.indexOf(']', jsonEnd);
            let fullMatch = processedText.substring(tagIndex, closingBracket + 1);
            let jsonStr = processedText.substring(jsonStart, jsonEnd + 1);
            try {
                const config = new Function(`return (${jsonStr})`)();
                const cid = `chart-${Math.random().toString(36).substr(2, 9)}`;
                extractedConfigs.push({ id: cid, config });
                processedText = processedText.replace(fullMatch, '');
            } catch (e) { 
                processedText = processedText.replace(fullMatch, '[Error de Gráfico]'); 
            }
        } else break;
    }

    return { 
        html: window.marked ? marked.parse(processedText) : processedText, 
        charts: extractedConfigs 
    };
}

async function executeModelFallback(promptText, index = 0) {
    const model = MODELS_LIST[index] || MODELS_LIST[0];
    
    // Preparar historial para la API
    let contents = globalHistory.slice(-10).map(h => ({
        role: h.role === 'user' ? 'user' : 'model',
        parts: [{ text: h.text }]
    }));
    contents.push({ role: "user", parts: [{ text: promptText }] });

    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${API_KEY}`, { 
        method: 'POST', 
        headers: { 'Content-Type': 'application/json' }, 
        body: JSON.stringify({ 
            contents: contents, 
            systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] } 
        }) 
    });

    if (!res.ok) { 
        if (index < MODELS_LIST.length - 1) return executeModelFallback(promptText, index + 1); 
        throw new Error("No se pudo conectar con el núcleo de inteligencia."); 
    }
    return await res.json();
}

function speak(text) {
    if (!window.speechSynthesis) return;
    window.speechSynthesis.cancel();
    const cleanText = text.replace(/\[CHART_DATA[\s\S]*?\]/g, '').replace(/[#*`]/g, '');
    const utter = new SpeechSynthesisUtterance(cleanText);
    utter.lang = 'es-ES';
    utter.rate = 1.1;
    window.speechSynthesis.speak(utter);
}

// ====================== INICIALIZACIÓN Y EVENTOS ======================

function initApp() {
    modelStatus.innerText = `LINK: ${selectedModel}`;

    // Evento Clic en Enviar
    sendBtn.addEventListener('click', handleSendMessage);

    // Evento Tecla Enter
    userInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSendMessage();
        }
    });

    // Auto-ajuste de textarea
    userInput.addEventListener('input', ajustarInput);

    // Sidebar
    toggleSidebarBtn.onclick = () => sidebar.classList.toggle('collapsed');
    closeSidebarBtn.onclick = () => sidebar.classList.add('collapsed');

    // Limpiar Chat
    clearChatBtn.onclick = () => {
        if (confirm("¿Reiniciar terminal?")) {
            chatContainer.innerHTML = '';
            globalHistory = [];
            localStorage.removeItem('cyberpunk_history_v15');
            location.reload();
        }
    };
}

// Ejecutar al cargar
document.addEventListener('DOMContentLoaded', initApp);
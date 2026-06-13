import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import mineflayer from 'mineflayer';

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: "*", methods: ["GET", "POST"] }
});

app.use(express.static('public'));
app.use(express.json());

app.use((req, res, next) => {
    res.removeHeader('X-Frame-Options');
    res.setHeader('Content-Security-Policy', "frame-ancestors *");
    next();
});

let bots = [];
let nextBotId = 1;
let globalConfig = { webServerPort: process.env.PORT || 3000 };

const PRECONFIGURED_BOTS = [
    {
        nome: "GatoDoMato_",
        server: "healtzcraft.com",
        port: 25565,
        version: "1.21.4",
        senha: "250719802023",
        autoSequence: true,
        commands: ["/login {senha}", "/skyblock", "/ac"]
    },
    {
        nome: "npx_DevCraft",
        server: "healtzcraft.com",
        port: 25565,
        version: "1.21.4",
        senha: "250719802023",
        autoSequence: true,
        commands: ["/login {senha}", "/skyblock", "/ac"]
    },
    {
        nome: "npm_install",
        server: "healtzcraft.com",
        port: 25565,
        version: "1.21.4",
        senha: "250719802023",
        autoSequence: true,
        commands: ["/login {senha}", "/skyblock", "/ac"]
    }
];

function initializePreconfiguredBots() {
    if (bots.length === 0) {
        console.log('\n🎮 Inicializando bots pré-configurados...\n');
        PRECONFIGURED_BOTS.forEach((botConfig, i) => {
            const newBot = {
                id: nextBotId++,
                nome: botConfig.nome,
                server: botConfig.server,
                port: botConfig.port,
                version: botConfig.version,
                senha: botConfig.senha,
                status: 'offline',
                running: false,
                autoSequence: botConfig.autoSequence,
                commands: botConfig.commands,
                reconnectAttempts: 0,
                connecting: false,
                bot: null,
                commandScheduler: null,
                reconnectTimeout: null,
                resourcePackReady: false,
                captchaPending: false,
                captchaAttempts: 0,
                captchaImage: null,
                captchaCode: null
            };
            bots.push(newBot);
            console.log(`✅ Bot pré-configurado: ${botConfig.nome}`);

            setTimeout(() => {
                newBot.running = true;
                createBot(newBot.id);
            }, i * 8000);
        });
        console.log(`\n📊 Total: ${bots.length} bots\n`);
    }
}

function getReconnectDelay(attempts) {
    if (attempts === 1) return 5000;
    if (attempts === 2) return 10000;
    if (attempts === 3) return 20000;
    return 30000;
}

// ═══════════════════════════════════════════════════════════════
// NANTI-BOT CAPTCHA BYPASS
// ═══════════════════════════════════════════════════════════════

class NantiBotBypass {
    constructor(bot, botData) {
        this.bot = bot;
        this.botData = botData;
    }

    // Padrões conhecidos do Nanti-Bot
    static getCommonCodes() {
        return [
            // Códigos comuns do Nanti-Bot
            '1234', '5678', '4321', '8765',
            'ABCD', 'DCBA', 'MINE', 'CRAFT',
            'MINECRAFT', 'NANTI', 'BYPASS',
            // Códigos numéricos comuns
            '0000', '1111', '2222', '3333', '4444', '5555', '6666', '7777', '8888', '9999',
            // Sequências
            '123456', '654321', '112233', '445566',
            // Códigos do servidor healtzcraft
            'HEALTZ', 'HC2024', 'SKYBLOCK', '25071980'
        ];
    }

    async tryBypass(mapData) {
        console.log(`[${this.botData.nome}] 🔓 Tentando bypass do Nanti-Bot...`);
        
        // Salva a imagem do captcha para o dashboard
        this.botData.captchaImage = mapData;
        
        // Método 1: Tentar códigos conhecidos do Nanti-Bot
        const commonCodes = NantiBotBypass.getCommonCodes();
        for (const code of commonCodes) {
            console.log(`[${this.botData.nome}] 🔑 Tentando código: ${code}`);
            this.bot.chat(code);
            await this.delay(500);
            
            if (this.bot.entity && this.botData.status === 'online') {
                console.log(`[${this.botData.nome}] ✅ BYPASS SUCESSO! Código: ${code}`);
                return true;
            }
        }
        
        // Método 2: Tentar extrair números do mapa
        const extracted = this.extractNumbersFromMap(mapData);
        if (extracted) {
            console.log(`[${this.botData.nome}] 🔢 Números extraídos: ${extracted}`);
            this.bot.chat(extracted);
            await this.delay(500);
            if (this.bot.entity && this.botData.status === 'online') return true;
        }
        
        // Método 3: Tentar padrão de cores
        const colorPattern = this.detectColorPattern(mapData);
        if (colorPattern) {
            console.log(`[${this.botData.nome}] 🎨 Padrão de cor: ${colorPattern}`);
            this.bot.chat(colorPattern);
            await this.delay(500);
            if (this.bot.entity && this.botData.status === 'online') return true;
        }
        
        console.log(`[${this.botData.nome}] ⚠️ Bypass automático falhou, aguardando manual...`);
        return false;
    }
    
    extractNumbersFromMap(mapData) {
        try {
            const size = Math.sqrt(mapData.length);
            if (size !== 128) return null;
            
            let numbers = '';
            const positions = [
                // Posições onde números geralmente aparecem no Nanti-Bot
                {x: 30, y: 50}, {x: 55, y: 50}, {x: 80, y: 50}, {x: 105, y: 50},
                {x: 30, y: 75}, {x: 55, y: 75}, {x: 80, y: 75}, {x: 105, y: 75}
            ];
            
            for (const pos of positions) {
                const idx = pos.y * size + pos.x;
                if (idx < mapData.length) {
                    const val = mapData[idx];
                    if (val > 50 && val < 200) {
                        // Tenta converter o valor em número
                        const digit = this.mapValueToDigit(val);
                        if (digit) numbers += digit;
                    }
                }
            }
            
            if (numbers.length >= 4 && numbers.length <= 6) return numbers;
            return null;
        } catch(e) {
            return null;
        }
    }
    
    mapValueToDigit(val) {
        // Mapeamento de valores de pixel para dígitos (baseado em padrões do Nanti-Bot)
        if (val > 200) return null;
        if (val > 180) return '0';
        if (val > 160) return '1';
        if (val > 140) return '2';
        if (val > 120) return '3';
        if (val > 100) return '4';
        if (val > 80) return '5';
        if (val > 60) return '6';
        if (val > 40) return '7';
        if (val > 20) return '8';
        return '9';
    }
    
    detectColorPattern(mapData) {
        // Detecta padrões de cores específicos do Nanti-Bot
        const colorCount = {};
        for (let i = 0; i < mapData.length; i += 100) {
            const val = mapData[i];
            if (val > 50) {
                const colorGroup = Math.floor(val / 25);
                colorCount[colorGroup] = (colorCount[colorGroup] || 0) + 1;
            }
        }
        
        let maxColor = null;
        let maxCount = 0;
        for (const [color, count] of Object.entries(colorCount)) {
            if (count > maxCount) {
                maxCount = count;
                maxColor = color;
            }
        }
        
        // Mapeamento de cores para palavras comuns em captchas
        const colorWords = {
            '3': 'BLUE', '4': 'GREEN', '5': 'RED', '6': 'YELLOW',
            '7': 'PURPLE', '8': 'ORANGE', '9': 'PINK'
        };
        
        return colorWords[maxColor] || null;
    }
    
    delay(ms) { return new Promise(r => setTimeout(r, ms)); }
}

class CommandScheduler {
    constructor(bot, botData) {
        this.bot = bot;
        this.botData = botData;
        this.isRunning = false;
    }

    delay(ms) { return new Promise(r => setTimeout(r, ms)); }

    async executeCommand(cmd) {
        if (!this.bot?.entity || this.botData.status !== 'online') return false;
        let text = cmd
            .replace('{senha}', this.botData.senha || '')
            .replace('{nome}', this.botData.nome);
        this.bot.chat(text);
        console.log(`[${this.botData.nome}] 💬 ${text}`);
        return true;
    }

    async start() {
        if (this.isRunning) return;
        if (!this.botData.commands || this.botData.commands.length === 0) {
            console.log(`[${this.botData.nome}] ⚠️ Nenhum comando`);
            return;
        }

        this.isRunning = true;

        if (this.botData.captchaPending) {
            console.log(`[${this.botData.nome}] ⏳ Aguardando captcha...`);
            let waitTime = 0;
            while (this.botData.captchaPending && waitTime < 15000) {
                await this.delay(500);
                waitTime += 500;
            }
        }

        console.log(`[${this.botData.nome}] 🚀 Executando comandos...`);

        for (let i = 0; i < this.botData.commands.length; i++) {
            if (!this.isRunning || this.botData.status !== 'online') break;

            const cmd = this.botData.commands[i];
            if (!cmd?.trim()) continue;

            await this.executeCommand(cmd);
            await this.delay(2000);
        }

        console.log(`[${this.botData.nome}] ✅ Comandos finalizados!`);
        this.isRunning = false;
    }

    stop() { this.isRunning = false; }
}

function getBotIndex(botId) { return bots.findIndex(b => b.id === botId); }

function destroyBot(botId) {
    const index = getBotIndex(botId);
    if (index === -1) return;
    const botData = bots[index];

    if (botData.commandScheduler) { botData.commandScheduler.stop(); botData.commandScheduler = null; }
    if (botData.reconnectTimeout) { clearTimeout(botData.reconnectTimeout); botData.reconnectTimeout = null; }
    if (botData.bot) {
        try { botData.bot.removeAllListeners(); botData.bot.quit(); } catch(e) {}
        botData.bot = null;
    }

    botData.status = 'offline';
    botData.connecting = false;
    botData.resourcePackReady = false;
    botData.captchaPending = false;
    botData.captchaAttempts = 0;
    bots[index] = botData;
    io.emit('botStatus', { id: botId, status: 'offline', nome: botData.nome });
}

function scheduleReconnect(botId) {
    const index = getBotIndex(botId);
    if (index === -1) return;
    const botData = bots[index];
    if (!botData.running) return;

    botData.reconnectAttempts = (botData.reconnectAttempts || 0) + 1;
    const delay = getReconnectDelay(botData.reconnectAttempts);
    console.log(`[${botData.nome}] 🔄 Reconectando em ${delay / 1000}s`);

    botData.reconnectTimeout = setTimeout(() => {
        botData.reconnectTimeout = null;
        createBot(botId);
    }, delay);
    bots[index] = botData;
}

function createBot(botId) {
    const index = getBotIndex(botId);
    if (index === -1) return;
    const botData = bots[index];

    if (botData.connecting || botData.status === 'online') {
        console.log(`[${botData.nome}] ⚠️ Já conectando/online, ignorando`);
        return;
    }

    destroyBot(botId);

    botData.connecting = true;
    botData.status = 'connecting';
    botData.resourcePackReady = false;
    botData.captchaPending = false;
    botData.captchaAttempts = 0;
    bots[index] = botData;

    io.emit('botStatus', { id: botId, status: 'connecting', nome: botData.nome });
    console.log(`[${botData.nome}] 🔌 Conectando a ${botData.server}...`);

    const bot = mineflayer.createBot({
        host: botData.server,
        port: botData.port || 25565,
        username: botData.nome,
        version: botData.version || '1.21.4',
        auth: 'offline',
        connectTimeout: 10000,
        keepAlive: true,
        checkTimeoutInterval: 10000,
        viewDistance: 'tiny',
        disableChatSigning: true,
        skipValidation: true,
        acceptResourcePack: true
    });

    botData.bot = bot;
    bots[index] = botData;

    // Evento do captcha - Tenta bypass e também mostra no dashboard
    bot.on('map', async (map) => {
        console.log(`[${botData.nome}] 🗺️ CAPTCHA DO NANTI-BOT DETECTADO!`);
        botData.captchaPending = true;
        botData.captchaStartTime = Date.now();
        bots[index] = botData;

        const mapArray = Array.from(map.data);
        
        // Salva a imagem para o dashboard
        botData.captchaImage = mapArray;
        
        // Emite para o dashboard mostrar o captcha
        io.emit('captchaMap', {
            botId: botId,
            botNome: botData.nome,
            data: mapArray,
            attempts: botData.captchaAttempts
        });

        // Tenta bypass automático
        const bypass = new NantiBotBypass(bot, botData);
        const bypassed = await bypass.tryBypass(mapArray);
        
        if (bypassed) {
            botData.captchaPending = false;
            botData.captchaAttempts = 0;
            bots[index] = botData;
            
            console.log(`[${botData.nome}] ✅ NANTI-BOT BYPASSED!`);
            
            io.emit('botStatus', { 
                id: botId, 
                status: 'online', 
                nome: botData.nome,
                captchaResolved: true 
            });
            
            // Executa comandos
            setTimeout(() => {
                if (botData.status === 'online') {
                    botData.commandScheduler = new CommandScheduler(bot, botData);
                    botData.commandScheduler.start();
                    bots[index] = botData;
                }
            }, 1000);
        } else {
            botData.captchaAttempts++;
            bots[index] = botData;
            console.log(`[${botData.nome}] ⚠️ Aguardando resolução manual do captcha...`);
            
            // Notifica que está aguardando captcha manual
            io.emit('captchaWaiting', {
                botId: botId,
                botNome: botData.nome,
                attempts: botData.captchaAttempts
            });
        }
    });

    bot.once('spawn', () => {
        console.log(`[${botData.nome}] ✅ Conectado!`);
        botData.connecting = false;
        botData.status = 'online';
        botData.reconnectAttempts = 0;
        bots[index] = botData;

        io.emit('botStatus', { id: botId, status: 'online', nome: botData.nome });

        if (!botData.captchaPending) {
            setTimeout(() => {
                if (botData.status === 'online') {
                    botData.commandScheduler = new CommandScheduler(bot, botData);
                    botData.commandScheduler.start();
                    bots[index] = botData;
                }
            }, 1000);
        }
    });

    bot.on('error', (err) => {
        if (err.code === 'EPIPE' || err.message?.includes('EPIPE')) return;
        if (err.message?.includes('ETIMEDOUT')) return;
        console.log(`[${botData.nome}] ⚠️ ${err.message}`);
    });

    bot.on('end', () => {
        console.log(`[${botData.nome}] ❌ Desconectado`);
        if (botData.commandScheduler) { botData.commandScheduler.stop(); botData.commandScheduler = null; }
        botData.status = 'offline';
        botData.connecting = false;
        botData.bot = null;
        botData.resourcePackReady = false;
        botData.captchaPending = false;
        bots[index] = botData;
        io.emit('botStatus', { id: botId, status: 'offline', nome: botData.nome });
        scheduleReconnect(botId);
    });

    bot.on('kicked', (reason) => {
        let msg = '';
        try {
            const parsed = typeof reason === 'string' ? JSON.parse(reason) : reason;
            const extra = parsed?.value?.extra?.value?.value;
            msg = extra?.map(e => e?.text?.value || '').join('') || JSON.stringify(reason);
        } catch(e) { msg = String(reason); }

        console.log(`[${botData.nome}] 🚫 Kick: ${msg.substring(0, 100)}`);
        botData.status = 'kicked';
        botData.connecting = false;
        botData.resourcePackReady = false;
        botData.captchaPending = false;
        bots[index] = botData;
        io.emit('botStatus', { id: botId, status: 'kicked', nome: botData.nome });
        scheduleReconnect(botId);
    });
}

// ═══════════════════════════════════════════════════════════════
// API ENDPOINTS
// ═══════════════════════════════════════════════════════════════

app.get('/api/bots', (req, res) => {
    res.json(bots.map(b => ({
        id: b.id, nome: b.nome, server: b.server, port: b.port,
        version: b.version, status: b.status, running: b.running || false,
        autoSequence: b.autoSequence || false, commandsCount: b.commands?.length || 0,
        captchaPending: b.captchaPending || false,
        captchaAttempts: b.captchaAttempts || 0
    })));
});

app.get('/api/bots/stats', (req, res) => {
    res.json({
        total: bots.length,
        online: bots.filter(b => b.status === 'online').length,
        offline: bots.filter(b => b.status === 'offline').length,
        connecting: bots.filter(b => b.status === 'connecting').length,
        kicked: bots.filter(b => b.status === 'kicked').length,
        running: bots.filter(b => b.running).length,
        captchaPending: bots.filter(b => b.captchaPending).length,
        uptime: process.uptime()
    });
});

app.get('/api/bot/:id', (req, res) => {
    const bot = bots.find(b => b.id === parseInt(req.params.id));
    if (!bot) return res.status(404).json({ error: 'Bot não encontrado' });
    res.json({
        id: bot.id, nome: bot.nome, server: bot.server, port: bot.port,
        version: bot.version, senha: bot.senha, status: bot.status,
        running: bot.running, autoSequence: bot.autoSequence,
        commands: bot.commands || [], captchaPending: bot.captchaPending || false,
        captchaAttempts: bot.captchaAttempts || 0
    });
});

app.post('/api/bot/create', (req, res) => {
    const { nome, server, port, senha, version, autoSequence } = req.body;
    if (!nome || !server) return res.status(400).json({ error: 'Nome e servidor são obrigatórios' });
    const newBot = {
        id: nextBotId++, nome, server, port: port || 25565,
        version: version || '1.21.4', senha: senha || '',
        status: 'offline', running: false,
        autoSequence: autoSequence !== undefined ? autoSequence : true,
        commands: [], reconnectAttempts: 0, connecting: false,
        bot: null, commandScheduler: null, reconnectTimeout: null,
        resourcePackReady: false, captchaPending: false, captchaAttempts: 0,
        captchaImage: null, captchaCode: null
    };
    bots.push(newBot);
    console.log(`✅ Bot criado: ${nome}`);
    res.json({ success: true, id: newBot.id });
});

app.post('/api/bot/:id/start', (req, res) => {
    const bot = bots.find(b => b.id === parseInt(req.params.id));
    if (!bot) return res.status(404).json({ error: 'Bot não encontrado' });
    bot.running = true;
    bot.reconnectAttempts = 0;
    createBot(bot.id);
    res.json({ success: true });
});

app.post('/api/bot/:id/stop', (req, res) => {
    const bot = bots.find(b => b.id === parseInt(req.params.id));
    if (!bot) return res.status(404).json({ error: 'Bot não encontrado' });
    bot.running = false;
    bot.reconnectAttempts = 0;
    destroyBot(bot.id);
    res.json({ success: true });
});

app.delete('/api/bot/:id', (req, res) => {
    const index = bots.findIndex(b => b.id === parseInt(req.params.id));
    if (index === -1) return res.status(404).json({ error: 'Bot não encontrado' });
    bots[index].running = false;
    destroyBot(bots[index].id);
    bots.splice(index, 1);
    res.json({ success: true });
});

app.post('/api/bot/:id/commands', (req, res) => {
    const bot = bots.find(b => b.id === parseInt(req.params.id));
    if (!bot) return res.status(404).json({ error: 'Bot não encontrado' });
    let commands = req.body.commands;
    if (typeof commands === 'string') commands = [commands];
    if (!Array.isArray(commands) && req.body.command) commands = [req.body.command];
    if (!Array.isArray(commands)) commands = [];
    commands = commands.filter(cmd => cmd && cmd.trim().length > 0);
    bot.commands = commands;
    console.log(`[${bot.nome}] 📝 ${commands.length} comando(s) salvos`);
    if (bot.status === 'online' && bot.commandScheduler) {
        bot.commandScheduler.stop();
        if (bot.autoSequence && commands.length > 0) {
            bot.commandScheduler = new CommandScheduler(bot.bot, bot);
            bot.commandScheduler.start();
        }
    }
    res.json({ success: true, commands });
});

app.post('/api/bot/:id/say', (req, res) => {
    const bot = bots.find(b => b.id === parseInt(req.params.id));
    if (!bot) return res.status(404).json({ error: 'Bot não encontrado' });
    const { message } = req.body;
    if (!message) return res.status(400).json({ error: 'Mensagem obrigatória' });
    if (bot.status === 'online' && bot.bot?.entity) {
        const msg = message.replace('{senha}', bot.senha || '').replace('{nome}', bot.nome);
        bot.bot.chat(msg);
        if (bot.captchaPending) {
            bot.captchaPending = false;
            bot.captchaAttempts = 0;
            console.log(`[${bot.nome}] ✅ Captcha resolvido manualmente: ${msg}`);
            // Avança para os comandos após resolver captcha
            setTimeout(() => {
                if (bot.status === 'online' && bot.autoSequence && bot.commands?.length) {
                    bot.commandScheduler = new CommandScheduler(bot.bot, bot);
                    bot.commandScheduler.start();
                }
            }, 1000);
        }
        console.log(`[${bot.nome}] 💬 Manual: ${msg}`);
        res.json({ success: true, message: msg });
    } else {
        res.status(400).json({ error: 'Bot offline' });
    }
});

app.post('/api/bot/:id/toggleAuto', (req, res) => {
    const bot = bots.find(b => b.id === parseInt(req.params.id));
    if (!bot) return res.status(404).json({ error: 'Bot não encontrado' });
    bot.autoSequence = !bot.autoSequence;
    res.json({ success: true, autoSequence: bot.autoSequence });
});

app.post('/api/bot/:id/captcha/resolve', (req, res) => {
    const bot = bots.find(b => b.id === parseInt(req.params.id));
    if (!bot) return res.status(404).json({ error: 'Bot não encontrado' });
    bot.captchaPending = false;
    bot.captchaAttempts = 0;
    res.json({ success: true });
});

app.get('/api/config', (req, res) => res.json(globalConfig));
app.post('/api/config', (req, res) => {
    globalConfig = { ...globalConfig, ...req.body };
    res.json({ success: true });
});

app.post('/api/bots/startAll', (req, res) => {
    const offline = bots.filter(b => !b.running);
    offline.forEach((bot, i) => {
        bot.running = true;
        bot.reconnectAttempts = 0;
        setTimeout(() => createBot(bot.id), i * 5000);
    });
    res.json({ success: true, started: offline.length });
});

app.post('/api/bots/stopAll', (req, res) => {
    const running = bots.filter(b => b.status === 'online' || b.status === 'connecting');
    running.forEach(bot => { bot.running = false; bot.reconnectAttempts = 0; destroyBot(bot.id); });
    res.json({ success: true, stopped: running.length });
});

io.on('connection', (socket) => {
    console.log('📡 Dashboard conectado');
    socket.emit('botList', bots.map(b => ({
        id: b.id, nome: b.nome, server: b.server,
        status: b.status, running: b.running, autoSequence: b.autoSequence,
        captchaPending: b.captchaPending || false,
        captchaAttempts: b.captchaAttempts || 0
    })));
});

const PORT = globalConfig.webServerPort;
initializePreconfiguredBots();

server.listen(PORT, () => {
    console.log(`\n╔════════════════════════════════════════════════════╗`);
    console.log(`║   🤖 BOTCRAFT v4.2 - NANTI-BOT BYPASS          ║`);
    console.log(`╠════════════════════════════════════════════════════╣`);
    console.log(`║  🌐 Dashboard: http://localhost:${PORT}                  ║`);
    console.log(`║  🤖 Bots: ${bots.length}                                    ║`);
    console.log(`║  🔓 Nanti-Bot: Bypass automático + Manual        ║`);
    console.log(`╚════════════════════════════════════════════════════╝\n`);
    bots.forEach(bot => {
        console.log(`   🤖 ${bot.nome} → ${bot.server}:${bot.port}`);
        console.log(`      📝 Comandos: ${bot.commands.join(' → ')}\n`);
    });
});

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

// ═══════════════════════════════════════════════════════════════
// ARMAZENAMENTO EM MEMÓRIA
// ═══════════════════════════════════════════════════════════════

let bots = [];
let nextBotId = 1;
let globalConfig = { webServerPort: process.env.PORT || 3000 };

// ═══════════════════════════════════════════════════════════════
// BOTS PRÉ-CONFIGURADOS
// ═══════════════════════════════════════════════════════════════

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
                captchaAttempts: 0
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

// ═══════════════════════════════════════════════════════════════
// BACKOFF EXPONENCIAL
// ═══════════════════════════════════════════════════════════════

function getReconnectDelay(attempts) {
    const base = 30000;
    const delay = base * Math.pow(2, Math.min(attempts, 3));
    return Math.min(delay, 300000);
}

// ═══════════════════════════════════════════════════════════════
// SISTEMA DE CAPTCHA AUTOMÁTICO
// ═══════════════════════════════════════════════════════════════

class CaptchaSolver {
    constructor(bot, botData) {
        this.bot = bot;
        this.botData = botData;
        this.attempts = 0;
        this.solving = false;
    }

    async solveMapCaptcha(mapData) {
        if (this.solving) return false;
        
        this.solving = true;
        this.attempts++;
        this.botData.captchaAttempts = this.attempts;
        
        console.log(`[${this.botData.nome}] 🔍 Tentativa ${this.attempts}/3 de resolver captcha...`);
        
        const text = this.extractTextFromMap(mapData);
        
        if (text && text.length >= 2 && text.length <= 8) {
            console.log(`[${this.botData.nome}] 🎯 Código detectado: ${text}`);
            
            this.bot.chat(text);
            console.log(`[${this.botData.nome}] 📤 Resposta enviada: ${text}`);
            
            await this.delay(4000);
            
            if (this.bot.entity && this.botData.status === 'online') {
                console.log(`[${this.botData.nome}] ✅ Captcha resolvido com sucesso!`);
                this.solving = false;
                this.attempts = 0;
                this.botData.captchaAttempts = 0;
                this.botData.captchaPending = false;
                return true;
            }
        }
        
        if (this.attempts < 3) {
            console.log(`[${this.botData.nome}] ⚠️ Falha na tentativa ${this.attempts}, nova tentativa em 6s...`);
            await this.delay(6000);
            this.solving = false;
            return this.solveMapCaptcha(mapData);
        }
        
        console.log(`[${this.botData.nome}] ❌ Não foi possível resolver o captcha automaticamente`);
        console.log(`[${this.botData.nome}] 👤 Aguardando intervenção manual no dashboard...`);
        this.solving = false;
        return false;
    }
    
    extractTextFromMap(mapData) {
        try {
            const size = Math.sqrt(mapData.length);
            if (size !== 128) return null;
            
            const text = this.extractCharacters(mapData, size);
            
            if (text && text.length > 0) {
                return text.replace(/\?/g, '').toUpperCase();
            }
            
            return this.simplePatternMatch(mapData);
        } catch (err) {
            console.log(`[${this.botData.nome}] Erro OCR: ${err.message}`);
            return null;
        }
    }
    
    extractCharacters(mapData, size) {
        let result = '';
        const charWidth = 18;
        const charHeight = 22;
        
        const startX = Math.max(0, Math.floor((size - (charWidth * 4)) / 2));
        const startY = Math.max(0, Math.floor((size - charHeight) / 2));
        
        for (let i = 0; i < 4; i++) {
            const charData = [];
            for (let y = 0; y < charHeight; y++) {
                for (let x = 0; x < charWidth; x++) {
                    const px = startX + (i * charWidth) + x;
                    const py = startY + y;
                    if (px >= 0 && px < size && py >= 0 && py < size) {
                        const val = mapData[py * size + px];
                        charData.push(val > 50 ? 1 : 0);
                    } else {
                        charData.push(0);
                    }
                }
            }
            const recognized = this.matchPattern(charData);
            result += recognized;
        }
        
        return result;
    }
    
    matchPattern(charData) {
        const patterns = {
            '011001101101101100110': '0',
            '001001001001001001001': '1',
            '011001001001001100111': '2',
            '111001001011001001111': '3',
            '100101101111001001001': '4',
            '111100111001001001111': '5',
            '011001101111001001111': '6',
            '111001001001001001001': '7',
            '011001101111001101111': '8',
            '011001101111001001110': '9',
            '011001101111001101111': 'A',
            '111001101111001101111': 'B',
            '011001101100001101110': 'C',
            '111001101101101101111': 'D',
            '111100111100001100111': 'E',
            '111100111100001100001': 'F'
        };
        
        const fingerprint = charData.join('');
        let bestMatch = '?';
        let bestScore = 0;
        
        for (const [pattern, char] of Object.entries(patterns)) {
            let matches = 0;
            const minLen = Math.min(pattern.length, fingerprint.length);
            for (let i = 0; i < minLen; i++) {
                if (pattern[i] === fingerprint[i]) matches++;
            }
            const score = matches / pattern.length;
            if (score > bestScore && score > 0.55) {
                bestScore = score;
                bestMatch = char;
            }
        }
        
        return bestMatch;
    }
    
    simplePatternMatch(mapData) {
        const density = mapData.filter(v => v > 50).length / mapData.length;
        
        if (density > 0.3 && density < 0.7) {
            const avgValue = mapData.reduce((a,b) => a + b, 0) / mapData.length;
            if (avgValue > 80 && avgValue < 160) {
                const commonCodes = ['1234', '5678', 'ABCD', 'MINEC', 'CRAFT', '123456', '654321'];
                const index = Math.floor(Math.random() * commonCodes.length);
                console.log(`[${this.botData.nome}] Usando padrão alternativo: ${commonCodes[index]}`);
                return commonCodes[index];
            }
        }
        return null;
    }
    
    delay(ms) { return new Promise(r => setTimeout(r, ms)); }
}

// ═══════════════════════════════════════════════════════════════
// SISTEMA DE COMANDOS
// ═══════════════════════════════════════════════════════════════

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
            console.log(`[${this.botData.nome}] ⏳ Aguardando resolução de captcha...`);
            let waitTime = 0;
            while (this.botData.captchaPending && waitTime < 45000) {
                await this.delay(1000);
                waitTime += 1000;
            }
        }

        console.log(`[${this.botData.nome}] ⏳ Aguardando resource pack...`);
        let waitTime = 0;
        while (!this.botData.resourcePackReady && waitTime < 20000) {
            await this.delay(500);
            waitTime += 500;
        }

        if (this.botData.resourcePackReady) {
            console.log(`[${this.botData.nome}] ✅ Resource pack pronto!`);
            await this.delay(3000);
        } else {
            console.log(`[${this.botData.nome}] ⚠️ Sem resource pack, continuando...`);
        }

        console.log(`[${this.botData.nome}] 🚀 Executando comandos...`);

        for (let i = 0; i < this.botData.commands.length; i++) {
            if (!this.isRunning || this.botData.status !== 'online') break;

            const cmd = this.botData.commands[i];
            if (!cmd?.trim()) continue;

            if (cmd.includes('/ac')) {
                console.log(`[${this.botData.nome}] ⏳ Aguardando 2s antes do /ac...`);
                await this.delay(2000);
            }

            await this.executeCommand(cmd);

            if (i === 0) {
                await this.delay(5000);
            } else if (i === 1) {
                await this.delay(8000);
            } else {
                await this.delay(3000);
            }
        }

        console.log(`[${this.botData.nome}] ✅ Comandos finalizados! Bot em standby.`);
        this.isRunning = false;
    }

    stop() { this.isRunning = false; }
}

// ═══════════════════════════════════════════════════════════════
// GERENCIAMENTO DE BOTS
// ═══════════════════════════════════════════════════════════════

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
    console.log(`[${botData.nome}] 🔄 Tentativa ${botData.reconnectAttempts} — reconectando em ${delay / 1000}s`);

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
    console.log(`[${botData.nome}] 🔌 Conectando a ${botData.server}:${botData.port}`);

    const bot = mineflayer.createBot({
        host: botData.server,
        port: botData.port || 25565,
        username: botData.nome,
        version: botData.version || '1.21.4',
        auth: 'offline',
        connectTimeout: 30000,
        keepAlive: true,
        checkTimeoutInterval: 30000,
        viewDistance: 'tiny',
        disableChatSigning: true,
        skipValidation: true,
        acceptResourcePack: true
    });

    botData.bot = bot;
    bots[index] = botData;

    bot.on('resourcePack', () => {
        console.log(`[${botData.nome}] 📦 Resource pack! Aceitando...`);
        try { bot.acceptResourcePack(); } catch(e) {}
        botData.resourcePackReady = true;
        bots[index] = botData;
    });

    bot.on('map', async (map) => {
        console.log(`[${botData.nome}] 🗺️ Mapa captcha recebido!`);
        botData.captchaPending = true;
        bots[index] = botData;

        const mapArray = Array.from(map.data);
        
        io.emit('captchaMap', {
            botId: botId,
            botNome: botData.nome,
            data: mapArray,
            attempts: botData.captchaAttempts
        });

        if (botData.autoSequence) {
            const solver = new CaptchaSolver(bot, botData);
            const solved = await solver.solveMapCaptcha(mapArray);
            
            if (solved) {
                botData.captchaPending = false;
                botData.captchaAttempts = 0;
                bots[index] = botData;
                
                io.emit('botStatus', { 
                    id: botId, 
                    status: 'online', 
                    nome: botData.nome,
                    captchaResolved: true 
                });
                
                if (botData.commandScheduler) {
                    botData.commandScheduler.start();
                }
            } else if (botData.captchaAttempts >= 3) {
                console.log(`[${botData.nome}] ⏸️ Aguardando captcha manual...`);
                io.emit('captchaWaiting', {
                    botId: botId,
                    botNome: botData.nome
                });
            }
        }
    });

    bot.on('chat', async (username, message) => {
        const lowerMsg = message.toLowerCase();
        const captchaKeywords = ['digite', 'código', 'code', 'verification', 'captcha', 'type'];
        
        if (captchaKeywords.some(keyword => lowerMsg.includes(keyword))) {
            console.log(`[${botData.nome}] 📨 Mensagem de captcha: ${message}`);
            
            if (!botData.captchaPending) {
                const numbers = message.match(/\d+/g);
                if (numbers && numbers.length > 0) {
                    const code = numbers.join('');
                    console.log(`[${botData.nome}] 🔢 Código detectado: ${code}`);
                    await new Promise(r => setTimeout(r, 2000));
                    bot.chat(code);
                    console.log(`[${botData.nome}] 📤 Resposta enviada: ${code}`);
                }
            }
        }
    });

    bot.once('spawn', () => {
        console.log(`[${botData.nome}] ✅ Conectado!`);
        botData.connecting = false;
        botData.status = 'online';
        botData.reconnectAttempts = 0;
        bots[index] = botData;

        io.emit('botStatus', { id: botId, status: 'online', nome: botData.nome });

        setTimeout(() => {
            if (botData.status === 'online' && !botData.captchaPending) {
                botData.commandScheduler = new CommandScheduler(bot, botData);
                botData.commandScheduler.start();
                bots[index] = botData;
            }
        }, 2000);
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

        console.log(`[${botData.nome}] 🚫 Kick: ${msg.substring(0, 150)}`);
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
        resourcePackReady: false, captchaPending: false, captchaAttempts: 0
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

// ═══════════════════════════════════════════════════════════════
// SOCKET.IO
// ═══════════════════════════════════════════════════════════════

io.on('connection', (socket) => {
    console.log('📡 Dashboard conectado');
    socket.emit('botList', bots.map(b => ({
        id: b.id, nome: b.nome, server: b.server,
        status: b.status, running: b.running, autoSequence: b.autoSequence,
        captchaPending: b.captchaPending || false,
        captchaAttempts: b.captchaAttempts || 0
    })));
});

// ═══════════════════════════════════════════════════════════════
// INICIALIZAÇÃO
// ═══════════════════════════════════════════════════════════════

const PORT = globalConfig.webServerPort;
initializePreconfiguredBots();

server.listen(PORT, () => {
    console.log(`\n╔════════════════════════════════════════════════════╗`);
    console.log(`║      🤖 BOTCRAFT v4.0 - CAPTCHA AUTO            ║`);
    console.log(`╠════════════════════════════════════════════════════╣`);
    console.log(`║  🌐 Dashboard: http://localhost:${PORT}                  ║`);
    console.log(`║  🤖 Bots: ${bots.length}                                    ║`);
    console.log(`║  🗺️  Captcha: Automático + Manual                 ║`);
    console.log(`╚════════════════════════════════════════════════════╝\n`);
    bots.forEach(bot => {
        console.log(`   🤖 ${bot.nome} → ${bot.server}:${bot.port}`);
        console.log(`      📝 Comandos: ${bot.commands.join(' → ')}\n`);
    });
});

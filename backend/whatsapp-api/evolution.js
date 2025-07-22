// whatsapp/evolution.js
const { default: makeWASocket, DisconnectReason, useMultiFileAuthState } = require('@whiskeysockets/baileys');
const qrImage = require('qr-image');
const fs = require('fs');
const path = require('path');

class WhatsAppClient {
    constructor() {
        this.sock = null;
        this.qrCode = null;
        this.isConnected = false;
        this.sessionPath = path.join(__dirname, 'session');
    }

    async initialize() {
        try {
            console.log('🚀 Inicializando WhatsApp Client...');
            
            // Garantir que pasta da sessão existe
            if (!fs.existsSync(this.sessionPath)) {
                fs.mkdirSync(this.sessionPath, { recursive: true });
            }

            const { state, saveCreds } = await useMultiFileAuthState(this.sessionPath);

            this.sock = makeWASocket({
                auth: state,
                printQRInTerminal: true,
                logger: {
                    level: 'error', // Reduzir logs
                    log: () => {} // Silenciar logs desnecessários
                }
            });

            // Event listeners
            this.sock.ev.on('creds.update', saveCreds);
            
            this.sock.ev.on('connection.update', (update) => {
                const { connection, lastDisconnect, qr } = update;

                if (qr) {
                    console.log('📱 QR Code gerado para WhatsApp');
                    this.qrCode = qr;
                    this.generateQRImage(qr);
                }

                if (connection === 'close') {
                    const shouldReconnect = (lastDisconnect?.error)?.output?.statusCode !== DisconnectReason.loggedOut;
                    console.log('❌ WhatsApp desconectado. Reconectar?', shouldReconnect);
                    this.isConnected = false;
                    
                    if (shouldReconnect) {
                        setTimeout(() => this.initialize(), 5000);
                    }
                } else if (connection === 'open') {
                    console.log('✅ WhatsApp conectado com sucesso!');
                    this.isConnected = true;
                    this.qrCode = null;
                }
            });

            this.sock.ev.on('messages.upsert', async (m) => {
                // Processar mensagens recebidas se necessário
                // console.log('📩 Mensagem recebida:', JSON.stringify(m, undefined, 2));
            });

            return true;
        } catch (error) {
            console.error('❌ Erro ao inicializar WhatsApp:', error);
            return false;
        }
    }

    generateQRImage(qr) {
        try {
            const qrPath = path.join(__dirname, 'qr-code.png');
            const qrPng = qrImage.image(qr, { type: 'png' });
            qrPng.pipe(fs.createWriteStream(qrPath));
            console.log('💾 QR Code salvo em:', qrPath);
        } catch (error) {
            console.error('❌ Erro ao gerar QR Code:', error);
        }
    }

    async sendMessage(phoneNumber, message) {
        try {
            if (!this.isConnected || !this.sock) {
                throw new Error('WhatsApp não está conectado');
            }

            // Formatar número (adicionar @s.whatsapp.net)
            const formattedNumber = this.formatPhoneNumber(phoneNumber);
            
            console.log('📤 Enviando mensagem para:', formattedNumber);
            console.log('💬 Mensagem:', message);

            await this.sock.sendMessage(formattedNumber, { text: message });
            
            console.log('✅ Mensagem enviada com sucesso!');
            return { success: true, message: 'Mensagem enviada' };
        } catch (error) {
            console.error('❌ Erro ao enviar mensagem:', error);
            return { success: false, error: error.message };
        }
    }

    formatPhoneNumber(phoneNumber) {
        // Remove todos os caracteres não numéricos
        let cleaned = phoneNumber.replace(/\D/g, '');
        
        // Se começar com 55, assumir que já tem código do país
        if (cleaned.startsWith('55')) {
            return cleaned + '@s.whatsapp.net';
        }
        
        // Se não tiver 55, adicionar
        if (cleaned.length === 11) {
            return '55' + cleaned + '@s.whatsapp.net';
        }
        
        // Formato padrão se não conseguir identificar
        return cleaned + '@s.whatsapp.net';
    }

    getConnectionStatus() {
        return {
            connected: this.isConnected,
            qrCode: this.qrCode,
            hasSession: fs.existsSync(path.join(this.sessionPath, 'creds.json'))
        };
    }

    async disconnect() {
        try {
            if (this.sock) {
                await this.sock.logout();
                this.sock = null;
                this.isConnected = false;
                console.log('🔌 WhatsApp desconectado');
            }
        } catch (error) {
            console.error('❌ Erro ao desconectar:', error);
        }
    }
}

module.exports = WhatsAppClient;
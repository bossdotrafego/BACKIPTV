// whatsapp-api/routes.js
const express = require('express');
const router = express.Router();
const MessageTemplates = require('./messages');

function createWhatsAppRoutes(whatsappClient) {
    // Status da conexão WhatsApp
    router.get('/status', (req, res) => {
        const status = whatsappClient.getConnectionStatus();
        res.json({
            success: true,
            ...status,
            timestamp: new Date().toISOString()
        });
    });

    // Obter QR Code
    router.get('/qr', (req, res) => {
        const status = whatsappClient.getConnectionStatus();
        
        if (status.qrCode) {
            res.json({
                success: true,
                qrCode: status.qrCode,
                message: 'Escaneie o QR Code com seu WhatsApp'
            });
        } else if (status.connected) {
            res.json({
                success: true,
                message: 'WhatsApp já está conectado'
            });
        } else {
            res.json({
                success: false,
                message: 'QR Code não disponível'
            });
        }
    });

    // Reconectar WhatsApp
    router.post('/reconnect', async (req, res) => {
        try {
            console.log('🔄 Iniciando reconexão do WhatsApp...');
            
            // Desconectar primeiro se estiver conectado
            await whatsappClient.disconnect();
            
            // Aguardar 2 segundos
            await new Promise(resolve => setTimeout(resolve, 2000));
            
            // Tentar reconectar
            const result = await whatsappClient.initialize();
            
            if (result) {
                res.json({
                    success: true,
                    message: 'Reconexão iniciada com sucesso',
                    timestamp: new Date().toISOString()
                });
            } else {
                res.status(500).json({
                    success: false,
                    message: 'Falha ao iniciar reconexão'
                });
            }
        } catch (error) {
            console.error('❌ Erro na reconexão:', error);
            res.status(500).json({
                success: false,
                error: error.message
            });
        }
    });

    // Enviar mensagem manual (para testes)
    router.post('/send', async (req, res) => {
        try {
            const { phoneNumber, message, nome } = req.body;

            if (!phoneNumber || !message) {
                return res.status(400).json({
                    success: false,
                    error: 'phoneNumber e message são obrigatórios'
                });
            }

            const result = await whatsappClient.sendMessage(phoneNumber, message);
            
            if (result.success) {
                res.json({
                    success: true,
                    message: 'Mensagem enviada com sucesso',
                    recipient: phoneNumber
                });
            } else {
                res.status(500).json({
                    success: false,
                    error: result.error
                });
            }
        } catch (error) {
            console.error('❌ Erro na rota /send:', error);
            res.status(500).json({
                success: false,
                error: error.message
            });
        }
    });

    // Enviar código de ativação
    router.post('/send-codigo', async (req, res) => {
        try {
            const { nome, whatsapp, codigo, plano } = req.body;

            if (!nome || !whatsapp || !codigo || !plano) {
                return res.status(400).json({
                    success: false,
                    error: 'Todos os campos são obrigatórios'
                });
            }

            const mensagem = MessageTemplates.codigoEntrega(nome, codigo, plano);
            const result = await whatsappClient.sendMessage(whatsapp, mensagem);
            
            if (result.success) {
                console.log(`✅ Código enviado para ${nome}: ${codigo}`);
                res.json({
                    success: true,
                    message: 'Código enviado via WhatsApp',
                    recipient: whatsapp
                });
            } else {
                console.error(`❌ Falha ao enviar código para ${nome}:`, result.error);
                res.status(500).json({
                    success: false,
                    error: result.error
                });
            }
        } catch (error) {
            console.error('❌ Erro na rota /send-codigo:', error);
            res.status(500).json({
                success: false,
                error: error.message
            });
        }
    });

    // Enviar lembrete de renovação
    router.post('/send-renovacao', async (req, res) => {
        try {
            const { nome, whatsapp, diasRestantes, plano } = req.body;

            if (!nome || !whatsapp || !plano) {
                return res.status(400).json({
                    success: false,
                    error: 'nome, whatsapp e plano são obrigatórios'
                });
            }

            const dias = diasRestantes || 3;
            const mensagem = MessageTemplates.renovacaoLembrete(nome, dias, plano);
            const result = await whatsappClient.sendMessage(whatsapp, mensagem);
            
            if (result.success) {
                console.log(`✅ Lembrete de renovação enviado para ${nome}`);
                res.json({
                    success: true,
                    message: 'Lembrete enviado via WhatsApp',
                    recipient: whatsapp
                });
            } else {
                res.status(500).json({
                    success: false,
                    error: result.error
                });
            }
        } catch (error) {
            console.error('❌ Erro na rota /send-renovacao:', error);
            res.status(500).json({
                success: false,
                error: error.message
            });
        }
    });

    // Desconectar WhatsApp
    router.post('/disconnect', async (req, res) => {
        try {
            await whatsappClient.disconnect();
            res.json({
                success: true,
                message: 'WhatsApp desconectado'
            });
        } catch (error) {
            res.status(500).json({
                success: false,
                error: error.message
            });
        }
    });

    // Teste de conectividade
    router.get('/test', (req, res) => {
        res.json({
            success: true,
            message: 'WhatsApp API está funcionando',
            timestamp: new Date().toISOString(),
            routes: [
                'GET /status - Status da conexão',
                'GET /qr - Obter QR Code',
                'POST /reconnect - Reconectar WhatsApp',
                'POST /send - Enviar mensagem manual',
                'POST /send-codigo - Enviar código',
                'POST /disconnect - Desconectar'
            ]
        });
    });

    return router;
}

module.exports = createWhatsAppRoutes;

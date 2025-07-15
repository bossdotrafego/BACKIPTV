require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs'); // Adicionado para a rota de admin
const { MercadoPagoConfig, Payment } = require('mercadopago');

const app = express();
app.use(cors());
app.use(express.json());

const client = new MercadoPagoConfig({ accessToken: process.env.MERCADO_PAGO_TOKEN });

app.post('/api/gerar-pagamento', async (req, res) => {
    try {
        const { nome, email, plano, valor } = req.body;
        if (!nome || !email || !plano || !valor) {
            return res.status(400).json({ erro: "Dados incompletos." });
        }

        const payment = new Payment(client);

        const body = {
            transaction_amount: Number(valor),
            description: `Recarga UniTV - ${plano}`,
            payment_method_id: 'pix',
            payer: {
                email: email,
                first_name: nome
            },
            notification_url: "https://codigounitvexpress.com/webhook-mercado-pago",
        };

        const result = await payment.create({ body });
        res.json({
            sucesso: true,
            id_pagamento: result.id,
            qr_code_base64: result.point_of_interaction.transaction_data.qr_code_base64,
            qr_code: result.point_of_interaction.transaction_data.qr_code
        });

    } catch (error) {
        // --- CORREÇÃO APLICADA AQUI ---
        if (error.response) {
            // Se o erro veio da API do Mercado Pago, ele terá uma propriedade 'response'
            console.error("⚠️ ERRO DETALHADO DO MERCADO PAGO:", error.response.data);
        } else {
            // Outros tipos de erro (ex: de conexão, de código, etc)
            console.error("⚠️ ERRO DESCONHECIDO:", error.message);
        }
        return res.status(500).json({ erro: "Erro ao gerar cobrança PIX." });
    }
});

// Suas rotas de admin...
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'admin_adicionar.html'));
});

app.post('/admin/adicionar', (req, res) => {
    const { senha, codigos } = req.body;
    if (senha !== process.env.SENHA_ADMIN) {
        return res.status(401).json({ erro: "Senha incorreta." });
    }
    const novosCodigos = codigos.split('\n').map(l => l.trim()).filter(Boolean).join('\n') + '\n';
    fs.appendFileSync('./codigos.txt', novosCodigos, 'utf8');
    return res.json({ mensagem: "✅ Códigos adicionados com sucesso! (ATENÇÃO: Sistema de TXT temporário)" });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Servidor rodando na porta ${PORT}`));
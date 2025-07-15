require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const { MercadoPagoConfig, Payment } = require('mercadopago');
const { Sequelize, DataTypes } = require('sequelize');

// --- CONFIGURAÇÃO DO BANCO DE DADOS (MODO SEGURO!) ---
// Agora ele lê as variáveis separadamente do .env
const sequelize = new Sequelize(process.env.DB_NAME, process.env.DB_USER, process.env.DB_PASSWORD, {
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  dialect: 'postgres',
  dialectOptions: {
    ssl: {
      require: true,
      rejectUnauthorized: false
    }
  }
});


// Criamos o "molde" da nossa tabela de códigos
const Codigo = sequelize.define('Codigo', {
  codigo: {
    type: DataTypes.STRING,
    allowNull: false,
    unique: true
  },
  status: {
    type: DataTypes.STRING,
    defaultValue: 'disponivel'
  },
  id_pagamento_mp: {
    type: DataTypes.STRING,
    allowNull: true
  }
}, {});


const app = express();
app.use(cors());
app.use(express.json());

// --- CONFIGURAÇÃO DO MERCADO PAGO ---
const client = new MercadoPagoConfig({ accessToken: process.env.MERCADO_PAGO_TOKEN });

// --- ROTAS (Nenhuma mudança aqui) ---
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
            payer: { email: email, first_name: nome },
            notification_url: "https://unitv.onrender.com/webhook",
        };
        const result = await payment.create({ body });
        res.json({
            sucesso: true,
            id_pagamento: result.id,
            qr_code_base64: result.point_of_interaction.transaction_data.qr_code_base64,
            qr_code: result.point_of_interaction.transaction_data.qr_code
        });
    } catch (error) {
        console.error("ERRO DETALHADO DO MERCADO PAGO:", error.cause || error.message);
        return res.status(500).json({ erro: "Erro ao gerar cobrança PIX." });
    }
});

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'admin_adicionar.html'));
});

app.post('/admin/adicionar', async (req, res) => {
    const { senha, codigos } = req.body;
    if (senha !== process.env.SENHA_ADMIN) {
        return res.status(401).json({ erro: "Senha incorreta." });
    }
    try {
        const listaCodigos = codigos.split('\n').map(l => l.trim()).filter(Boolean);
        const codigosParaCriar = listaCodigos.map(c => ({ codigo: c, status: 'disponivel' }));
        await Codigo.bulkCreate(codigosParaCriar, { ignoreDuplicates: true });
        return res.json({ mensagem: `✅ ${listaCodigos.length} códigos adicionados ao banco de dados com sucesso!` });
    } catch (error) {
        console.error("Erro ao adicionar códigos:", error);
        return res.status(500).json({ erro: "Erro ao salvar códigos no banco de dados." });
    }
});


// --- INICIAR SERVIDOR E CONECTAR AO BANCO ---
const PORT = process.env.PORT || 3000;
app.listen(PORT, async () => {
    console.log(`🚀 Servidor rodando na porta ${PORT}`);
    try {
        await sequelize.authenticate();
        console.log('✅ Conexão com o banco de dados estabelecida com sucesso.');
        await sequelize.sync({ alter: true });
        console.log('✅ Tabela de códigos sincronizada.');
    } catch (error) {
        console.error('❌ Não foi possível conectar ao banco de dados:', error);
    }
});
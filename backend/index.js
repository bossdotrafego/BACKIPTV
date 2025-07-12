require('dotenv').config();
const express = require('express');
const fs = require('fs');
const cors = require('cors');
const path = require('path');
const app = express();

app.use(cors());
app.use(express.json());

const SENHA_SECRETA = "admin123"; // 🔒 ALTERE AQUI SUA SENHA DE ADMIN

// ========== ROTA RAIZ (para evitar "Cannot GET /") ==========
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'admin_adicionar.html'));
});

// ========== ENTREGA DO CÓDIGO ==========
app.post('/api/pagamento', async (req, res) => {
    try {
        const { nome } = req.body;
        if (!nome) return res.status(400).json({ erro: "Nome é obrigatório." });

        const codigos = fs.readFileSync('./backend/codigos.txt', 'utf8').split('\n').filter(Boolean);
        if (codigos.length === 0) return res.status(500).json({ erro: "Sem códigos disponíveis." });

        const codigo = codigos.shift();
        fs.writeFileSync('./backend/codigos.txt', codigos.join('\n'));
        return res.json({ sucesso: true, codigo });
    } catch (err) {
        return res.status(500).json({ erro: "Erro ao gerar código." });
    }
});

// ========== PAINEL DE ADMIN ==========
app.get('/admin/adicionar', (req, res) => {
    res.sendFile(path.join(__dirname, 'admin_adicionar.html'));
});

app.post('/admin/adicionar', (req, res) => {
    const { senha, codigos } = req.body;
    if (senha !== SENHA_SECRETA) {
        return res.status(401).json({ erro: "Senha incorreta." });
    }

    if (!codigos || codigos.trim() === "") {
        return res.status(400).json({ erro: "Nenhum código enviado." });
    }

    const novosCodigos = codigos
        .split('\n')
        .map(l => l.trim())
        .filter(Boolean)
        .join('\n') + '\n';

    fs.appendFileSync('./backend/codigos.txt', novosCodigos, 'utf8');

    return res.json({ mensagem: "✅ Códigos adicionados com sucesso!" });
});

// ========== INICIAR SERVIDOR ==========
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Servidor rodando na porta ${PORT}`));

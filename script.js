import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getFirestore, collection, getDocs, doc, getDoc, setDoc, addDoc, updateDoc, deleteDoc, query, orderBy, serverTimestamp, onSnapshot }
    from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { getAuth, signInWithEmailAndPassword, onAuthStateChanged, signOut, sendPasswordResetEmail }
    from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";

const firebaseConfig = {
    apiKey: "AIzaSyC6Pr0I5YfB9QeVFdjxi-xdFlciXdfe9g8",
    authDomain: "doce-encanto-c4c61.firebaseapp.com",
    projectId: "doce-encanto-c4c61",
    storageBucket: "doce-encanto-c4c61.firebasestorage.app",
    messagingSenderId: "157198714742",
    appId: "1:157198714742:web:1cc3d70419c43cdb4c1c57"
};

const app  = initializeApp(firebaseConfig);
const db   = getFirestore(app);
const auth = getAuth(app);

let pedidos          = {};
let abaAtual         = 'pendente';
let somAtivado       = false;
let primeiraVez      = true;
let unsubscribePedidos = null; // referência do listener em tempo real, pra poder desligar no logout
let pedidosAbertos    = true; // estado local, sincronizado com o Firestore abaixo
let taxaEntregaAtual  = 0;    // idem, sincronizado com config/pedidos

// ── NOTIFICAÇÕES DO NAVEGADOR ────────────────────────────────────────────
if ('Notification' in window && Notification.permission === 'default') {
    Notification.requestPermission();
}

function notificarSistema(titulo, corpo) {
    if ('Notification' in window && Notification.permission === 'granted') {
        new Notification(titulo, { body: corpo, icon: 'doce_encanto_logo.png' });
    }
}

// ── AUTH ──────────────────────────────────────────────────────────────────
// Cadastro público foi removido de propósito: a única conta autorizada
// é criada manualmente pelo dono no Firebase Console (Authentication > Users).
onAuthStateChanged(auth, (user) => {
    if (user) {
        document.getElementById('tela-login').style.display  = 'none';
        document.getElementById('tela-painel').style.display = 'block';
        if (unsubscribePedidos) unsubscribePedidos();
        escutarPedidos();
    } else {
        document.getElementById('tela-login').style.display  = 'flex';
        document.getElementById('tela-painel').style.display = 'none';
        if (unsubscribePedidos) { unsubscribePedidos(); unsubscribePedidos = null; }
        primeiraVez = true; // reseta pra próxima vez que alguém logar
        pedidos = {};
    }
});

window.fazerLogin = async () => {
    const email = document.getElementById('input-email').value.trim();
    const senha = document.getElementById('input-senha').value.trim();
    const erro  = document.getElementById('erro-login');
    erro.textContent = '';
    try {
        await signInWithEmailAndPassword(auth, email, senha);
    } catch(e) {
        erro.textContent = 'Email ou senha incorretos.';
    }
};

window.fazerLogout = async () => await signOut(auth);

window.fazerResetSenha = () => {
    const email = document.getElementById('input-email').value.trim();
    const erro  = document.getElementById('erro-login');
    const msg   = document.getElementById('msg-login');
    erro.textContent = '';
    msg.textContent  = '';

    if (!email) {
        erro.textContent = 'Digite seu email no campo acima antes de clicar em "Esqueci minha senha".';
        return false;
    }

    sendPasswordResetEmail(auth, email)
        .then(() => {
            msg.textContent = 'Se esse email estiver cadastrado, enviamos um link para redefinir a senha. Verifique sua caixa de entrada.';
        })
        .catch(() => {
            msg.textContent = 'Se esse email estiver cadastrado, enviamos um link para redefinir a senha. Verifique sua caixa de entrada.';
        });

    return false;
};

// ── STATUS DOS PEDIDOS E TAXA DE ENTREGA ──────────────────────────────────
onSnapshot(doc(db, 'config', 'pedidos'), (snap) => {
    pedidosAbertos   = snap.exists() ? (snap.data().aberto !== false) : true;
    taxaEntregaAtual = snap.exists() ? Number(snap.data().taxaEntrega || 0) : 0;
    atualizarBotaoPedidos();
    atualizarCampoTaxa();
});

function atualizarBotaoPedidos() {
    const btn = document.getElementById('btnPedidos');
    if (!btn) return;
    if (pedidosAbertos) {
        btn.textContent = '🟢 Pedidos: Abertos';
        btn.classList.remove('pedidos-fechado');
        btn.classList.add('pedidos-aberto');
    } else {
        btn.textContent = '🔴 Pedidos: Pausados';
        btn.classList.remove('pedidos-aberto');
        btn.classList.add('pedidos-fechado');
    }
}

function atualizarCampoTaxa() {
    const input = document.getElementById('input-taxa-entrega');
    if (!input) return;
    // não sobrescreve enquanto o dono está digitando/focado no campo
    if (document.activeElement !== input) {
        input.value = taxaEntregaAtual.toFixed(2);
    }
}

window.togglePedidos = async () => {
    const novoStatus = !pedidosAbertos;
    try {
        await setDoc(doc(db, 'config', 'pedidos'), { aberto: novoStatus, atualizadoEm: serverTimestamp() }, { merge: true });
        showNotif(novoStatus ? 'Pedidos abertos ✓' : 'Pedidos pausados ✓', novoStatus ? 'Clientes já podem fazer pedidos.' : 'Clientes não conseguem mais pedir até você reativar.');
    } catch(e) {
        showNotif('Erro ao atualizar', 'Tente novamente.');
        console.error(e);
    }
};

window.salvarTaxaEntrega = async () => {
    const input = document.getElementById('input-taxa-entrega');
    const valor = parseFloat((input.value || '0').replace(',', '.'));
    if (isNaN(valor) || valor < 0) {
        showNotif('Valor inválido', 'Informe um número maior ou igual a zero.');
        atualizarCampoTaxa();
        return;
    }
    try {
        await setDoc(doc(db, 'config', 'pedidos'), { taxaEntrega: valor, atualizadoEm: serverTimestamp() }, { merge: true });
        showNotif('Taxa de entrega atualizada ✓', `R$ ${valor.toFixed(2).replace('.', ',')}`);
    } catch(e) {
        showNotif('Erro ao atualizar', 'Tente novamente.');
        console.error(e);
    }
};

// ── PEDIDOS (tempo real, sem polling) ───────────────────────────────────
function escutarPedidos() {
    const pedidosQuery = query(collection(db, 'pedidos'), orderBy('criadoEm', 'desc'));

    unsubscribePedidos = onSnapshot(pedidosQuery, (snap) => {
        snap.docs.forEach(d => {
            pedidos[d.id] = { _id: d.id, ...d.data() };
        });

        if (!primeiraVez) {
            snap.docChanges().forEach(change => {
                if (change.type === 'added') {
                    const p = pedidos[change.doc.id];
                    if (p && p.status === 'pendente') {
                        const msg = `${p.cliente} — R$ ${p.total.toFixed(2).replace('.', ',')}`;
                        showNotif('Novo pedido! 🛎️', msg);
                        notificarSistema('Novo pedido! 🛎️', msg);
                        if (somAtivado) playBeep();
                    }
                }
            });
        }
        primeiraVez = false;

        atualizarBadges();
        if (abaAtual !== 'cardapio') renderGrid();
        const agora = new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
        document.getElementById('atualizado-em').textContent = `Atualizado às ${agora}`;
    }, (erro) => {
        console.error('Erro no listener de pedidos:', erro);
    });
}

function atualizarBadges() {
    const c = { pendente:0, preparando:0, pronto:0, entregue:0 };
    Object.values(pedidos).forEach(p => { if (c[p.status] !== undefined) c[p.status]++; });
    document.getElementById('n-pendente').textContent   = c.pendente;
    document.getElementById('n-preparando').textContent = c.preparando;
    document.getElementById('n-pronto').textContent     = c.pronto;
    document.getElementById('n-entregue').textContent   = c.entregue;
}

function tempoRelativo(ts) {
    if (!ts) return '';
    const diff = Math.floor((Date.now() - ts.toDate().getTime()) / 1000);
    if (diff < 60)   return `há ${diff}s`;
    if (diff < 3600) return `há ${Math.floor(diff/60)}min`;
    return `há ${Math.floor(diff/3600)}h`;
}

const acoesPorStatus = {
    pendente:   p => `<button class="btn-preparar" onclick="atualizar('${p._id}','preparando')">👩‍🍳 Iniciar preparo</button>
                      <button class="btn-cancelar"  onclick="atualizar('${p._id}','cancelado')">✕ Cancelar</button>`,
    preparando: p => `<button class="btn-pronto"   onclick="atualizar('${p._id}','pronto')">✅ Marcar pronto</button>`,
    pronto:     p => p.tipoEntrega === 'entrega'
                      ? `<button class="btn-entregar" onclick="atualizar('${p._id}','entregue')">🛵 Marcar entregue</button>`
                      : `<button class="btn-entregar" onclick="atualizar('${p._id}','entregue')">📦 Marcar retirado</button>`,
    entregue:   p => `<span class="concluido-txt">Pedido concluído ✓</span>`,
};

function renderGrid() {
    const lista = Object.values(pedidos)
        .filter(p => p.status === abaAtual)
        .sort((a,b) => (a.criadoEm?.seconds||0) - (b.criadoEm?.seconds||0));
    const grid = document.getElementById('grid-pedidos');
    if (!lista.length) {
        const msgs = { pendente:'Nenhum pedido novo no momento.', preparando:'Nenhum pedido sendo preparado.', pronto:'Nenhum pedido pronto.', entregue:'Nenhum pedido concluído ainda.' };
        grid.innerHTML = `<div class="vazio"><p>${msgs[abaAtual]||''}</p></div>`;
        return;
    }
    grid.innerHTML = lista.map(p => `
        <div class="pedido-card ${p.status==='pendente'?'novo':''}">
            <div class="card-topo">
                <div>
                    <div class="card-cliente">👤 ${p.cliente}</div>
                    <div class="card-tempo">${tempoRelativo(p.criadoEm)}</div>
                </div>
                <span class="status-badge s-${p.status}">${{pendente:'⏳ Aguardando',preparando:'👩‍🍳 Preparando',pronto:'✅ Pronto',entregue:'📦 Concluído'}[p.status]||p.status}</span>
            </div>
            <div class="card-entrega ${p.tipoEntrega === 'entrega' ? 'tipo-entrega' : 'tipo-retirada'}">
                ${p.tipoEntrega === 'entrega' ? `🛵 Entrega: ${p.endereco || '—'}` : '🤝 Retirada combinada'}
            </div>
            <div class="card-itens">
                ${p.itens.map(i=>`
                    <div class="item-linha">
                        <span><span class="item-nome-bold">${i.qtd}×</span>${i.nome}</span>
                        <span>R$ ${(i.preco*i.qtd).toFixed(2).replace('.',',')}</span>
                    </div>`).join('')}
                ${p.taxaEntregaCobrada ? `
                    <div class="item-linha">
                        <span>Taxa de entrega</span>
                        <span>R$ ${Number(p.taxaEntregaCobrada).toFixed(2).replace('.',',')}</span>
                    </div>` : ''}
                ${p.observacoes ? `<div class="obs-box">📝 ${p.observacoes}</div>` : ''}
            </div>
            <div class="card-total">
                <span>Total</span>
                <span>R$ ${p.total.toFixed(2).replace('.',',')}</span>
            </div>
            <div class="card-acoes">
                ${(acoesPorStatus[p.status]||acoesPorStatus.entregue)(p)}
            </div>
        </div>`).join('');
}

window.atualizar = async (id, status) => {
    try {
        await updateDoc(doc(db,'pedidos',id), { status });
        pedidos[id].status = status;
        atualizarBadges();
        renderGrid();
    } catch(e) { alert('Erro ao atualizar pedido.'); console.error(e); }
};

window.mudarAba = (aba, el) => {
    abaAtual = aba;
    document.querySelectorAll('.aba').forEach(a => a.classList.remove('ativa'));
    el.classList.add('ativa');
    if (aba === 'cardapio') {
        carregarCardapio();
    } else {
        renderGrid();
    }
};

// ── LIMPAR ────────────────────────────────────────────────────────────────
window.confirmarLimpeza = () => document.getElementById('modalLimpeza').classList.add('open');
window.fecharModal      = () => document.getElementById('modalLimpeza').classList.remove('open');

window.limparConcluidos = async () => {
    fecharModal();
    const paraApagar = Object.values(pedidos).filter(p => p.status === 'entregue' || p.status === 'cancelado');
    if (!paraApagar.length) { showNotif('Nada para limpar', 'Não há pedidos concluídos ou cancelados.'); return; }
    try {
        await Promise.all(paraApagar.map(p => deleteDoc(doc(db,'pedidos',p._id))));
        paraApagar.forEach(p => delete pedidos[p._id]);
        atualizarBadges();
        renderGrid();
        showNotif('Limpeza concluída ✓', `${paraApagar.length} pedido(s) removido(s).`);
    } catch(e) { showNotif('Erro ao limpar', 'Tente novamente.'); console.error(e); }
};

// ── SOM ───────────────────────────────────────────────────────────────────
window.toggleSom = () => {
    somAtivado = !somAtivado;
    const btn = document.getElementById('btnSom');
    btn.textContent = somAtivado ? '🔔 Som: on' : '🔔 Som: off';
    btn.classList.toggle('ativo', somAtivado);
    if (somAtivado) playBeep();
};

function playBeep() {
    try {
        const ctx = new (window.AudioContext||window.webkitAudioContext)();
        [0,150,300].forEach(delay => {
            const o = ctx.createOscillator();
            const g = ctx.createGain();
            o.connect(g); g.connect(ctx.destination);
            o.frequency.value = 880;
            g.gain.setValueAtTime(.3, ctx.currentTime + delay/1000);
            g.gain.exponentialRampToValueAtTime(.001, ctx.currentTime + delay/1000 + .15);
            o.start(ctx.currentTime + delay/1000);
            o.stop(ctx.currentTime + delay/1000 + .15);
        });
    } catch(e) {}
}

// ── NOTIFICAÇÃO ───────────────────────────────────────────────────────────
function showNotif(titulo, desc) {
    document.getElementById('notif-titulo').textContent = titulo;
    document.getElementById('notif-desc').textContent   = desc;
    const n = document.getElementById('notif');
    n.classList.add('show');
    setTimeout(()=>n.classList.remove('show'), 4000);
}

// ── CARDÁPIO ADMIN ────────────────────────────────────────────────────────
// Categoria é texto livre (você decide os nomes: "Doces", "Bolos", "Bebidas"
// etc.) — não existe mais lista fixa no código. O campo abaixo sugere, via
// datalist, as categorias que você já usou, pra evitar "Doce" e "doces"
// virarem categorias diferentes por acidente.
let cardapio       = [];
let itemEditandoId = null;

async function carregarCardapio() {
    try {
        const snap = await getDocs(collection(db,'cardapio'));
        cardapio = snap.docs.map(d => ({ _id: d.id, ...d.data() }));
        renderCardapio();
    } catch(e) { console.error(e); }
}

function categoriasExistentes() {
    const nomes = new Set(cardapio.map(i => (i.categoria || '').trim()).filter(Boolean));
    return Array.from(nomes).sort((a,b) => a.localeCompare(b, 'pt-BR'));
}

function atualizarDatalistCategorias() {
    const datalist = document.getElementById('lista-categorias-sugestao');
    if (!datalist) return;
    datalist.innerHTML = categoriasExistentes().map(c => `<option value="${c}"></option>`).join('');
}

function renderCardapio() {
    const grid = document.getElementById('grid-pedidos');

    const grupos = {};
    cardapio.forEach(item => {
        const cat = (item.categoria || 'Outros').trim() || 'Outros';
        if (!grupos[cat]) grupos[cat] = [];
        grupos[cat].push(item);
    });

    const categorias = Object.keys(grupos).sort((a,b) => a.localeCompare(b, 'pt-BR'));

    const semItens = cardapio.length === 0
        ? '<p class="cardapio-vazio">Nenhum item cadastrado ainda. Clique em "+ Novo item" para começar.</p>'
        : '';

    grid.innerHTML = `
        <div class="cardapio-wrap">
            <div class="cardapio-header">
                <h3>Itens do cardápio</h3>
                <button class="btn-novo-item" onclick="abrirModalItem()">+ Novo item</button>
            </div>
            ${semItens}
            ${categorias.map(cat => `
                <div class="categoria-bloco">
                    <h4>${cat}</h4>
                    ${grupos[cat].map(item => `
                        <div class="card-cardapio">
                            <div class="card-cardapio-info">
                                <div class="card-cardapio-nome">${item.nome}</div>
                                ${item.descricao ? `<div class="card-cardapio-desc">${item.descricao}</div>` : ''}
                            </div>
                            <span class="card-cardapio-preco">R$ ${Number(item.preco).toFixed(2).replace('.',',')}</span>
                            <div class="card-cardapio-acoes">
                                <button class="btn-editar"  onclick="editarItem('${item._id}')">✏️ Editar</button>
                                <button class="btn-excluir" onclick="excluirItem('${item._id}')">🗑️ Excluir</button>
                            </div>
                        </div>`).join('')}
                </div>`).join('')}
        </div>`;

    atualizarDatalistCategorias();
}

window.abrirModalItem = () => {
    itemEditandoId = null;
    document.getElementById('modal-item-titulo').textContent = 'Novo item';
    document.getElementById('item-nome').value       = '';
    document.getElementById('item-desc').value       = '';
    document.getElementById('item-preco').value      = '';
    document.getElementById('item-categoria').value  = '';
    document.getElementById('erro-item').textContent = '';
    atualizarDatalistCategorias();
    document.getElementById('modalItem').classList.add('open');
};

window.editarItem = (id) => {
    const item = cardapio.find(c => c._id === id);
    if (!item) return;
    itemEditandoId = id;
    document.getElementById('modal-item-titulo').textContent = 'Editar item';
    document.getElementById('item-nome').value       = item.nome;
    document.getElementById('item-desc').value       = item.descricao || '';
    document.getElementById('item-preco').value      = item.preco;
    document.getElementById('item-categoria').value  = item.categoria || '';
    document.getElementById('erro-item').textContent = '';
    atualizarDatalistCategorias();
    document.getElementById('modalItem').classList.add('open');
};

window.fecharModalItem = () => document.getElementById('modalItem').classList.remove('open');

window.salvarItem = async () => {
    const nome      = document.getElementById('item-nome').value.trim();
    const descricao = document.getElementById('item-desc').value.trim();
    const preco     = parseFloat(document.getElementById('item-preco').value);
    const categoria = document.getElementById('item-categoria').value.trim();
    const erro      = document.getElementById('erro-item');

    if (!nome)                  { erro.textContent = 'Informe o nome do item.'; return; }
    if (!categoria)              { erro.textContent = 'Informe a categoria (ex: Doces, Bolos, Bebidas).'; return; }
    if (isNaN(preco) || preco <= 0) { erro.textContent = 'Informe um preço válido.'; return; }

    try {
        if (itemEditandoId) {
            await updateDoc(doc(db,'cardapio',itemEditandoId), { nome, descricao, preco, categoria });
        } else {
            await addDoc(collection(db,'cardapio'), { nome, descricao, preco, categoria, criadoEm: serverTimestamp() });
        }
        fecharModalItem();
        carregarCardapio();
        showNotif(itemEditandoId ? 'Item atualizado ✓' : 'Item adicionado ✓', nome);
    } catch(e) {
        erro.textContent = 'Erro ao salvar. Tente novamente.';
        console.error(e);
    }
};

window.excluirItem = async (id) => {
    if (!confirm('Excluir este item do cardápio?')) return;
    try {
        await deleteDoc(doc(db,'cardapio', id));
        carregarCardapio();
        showNotif('Item removido ✓', '');
    } catch(e) { showNotif('Erro ao excluir', 'Tente novamente.'); console.error(e); }
};
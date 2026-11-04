'use strict';

const config = window.ENCOMENDA_SUPABASE_CONFIG || {};
const client = (window.supabase?.createClient && config.url && config.anonKey)
  ? window.supabase.createClient(config.url, config.anonKey, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } })
  : null;

const form = document.getElementById('resetPasswordForm');
const message = document.getElementById('resetMessage');
const submit = form.querySelector('button[type="submit"]');
let recoverySessionReady = false;

function showMessage(text, success = false) {
  message.textContent = text;
  message.classList.toggle('success', success);
}

async function checkRecoverySession() {
  if (!client) {
    showMessage('A conexão com o Supabase não está configurada.');
    submit.disabled = true;
    return;
  }
  const { data, error } = await client.auth.getSession();
  if (error || !data.session) {
    showMessage('Este link de recuperação expirou ou já foi utilizado. Volte ao login e solicite outro.');
    submit.disabled = true;
    return;
  }
  recoverySessionReady = true;
}

form.addEventListener('submit', async event => {
  event.preventDefault();
  if (!recoverySessionReady) {
    showMessage('Abra novamente o link recebido por e-mail para validar sua recuperação.');
    return;
  }
  const password = document.getElementById('newPassword').value;
  const confirmation = document.getElementById('confirmPassword').value;
  if (password.length < 8) return showMessage('A senha precisa ter pelo menos 8 caracteres.');
  if (password !== confirmation) return showMessage('As senhas informadas não conferem.');

  submit.disabled = true;
  submit.textContent = 'Salvando...';
  try {
    const { error } = await client.auth.updateUser({ password });
    if (error) throw error;
    form.reset();
    showMessage('Senha alterada com sucesso. Você já pode voltar ao login.', true);
    submit.textContent = 'Senha atualizada';
  } catch (error) {
    showMessage(error.message || 'Não foi possível atualizar a senha.');
    submit.disabled = false;
    submit.textContent = 'Salvar nova senha';
  }
});

checkRecoverySession().catch(error => showMessage(error.message || 'Não foi possível validar o link.'));

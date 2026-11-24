'use strict';

/* Autenticação e gerenciamento de sessão. */

function showAuthenticatedApp() {
  state.page = 'home';
  $('#loginView').classList.add('hidden');
  $('#appView').classList.remove('hidden');
  renderApp();
}

function setLoginRole(role) {
  state.role = role;
  $$('.role-option').forEach(button => {
    const active = button.dataset.role === role;
    button.classList.toggle('active', active);
    button.setAttribute('aria-selected', String(active));
  });
  const label = $('#loginIdLabel');
  const idInput = $('#loginId');
  const hint = $('#loginHint');
  const forgot = $('#forgotPasswordButton');
  if (role === 'loja') {
    label.textContent = 'CNPJ da loja';
    idInput.type = 'text';
    idInput.placeholder = '00.000.000/0000-00';
    idInput.inputMode = 'numeric';
    idInput.autocomplete = 'username';
    hint.innerHTML = '<strong>Acesso da loja</strong><span>Informe o CNPJ da sua loja e utilize a senha global fornecida pela empresa.</span>';
    if (forgot) forgot.classList.add('hidden');
  } else {
    label.textContent = 'E-mail do comprador';
    idInput.type = 'email';
    idInput.placeholder = 'comprador@empresa.com.br';
    idInput.inputMode = 'email';
    idInput.autocomplete = 'username';
    hint.innerHTML = '<strong>Acesso do comprador</strong><span>Entre com seu e-mail e senha cadastrados.</span>';
    if (forgot) forgot.classList.remove('hidden');
  }
  idInput.value = '';
  $('#loginPassword').value = '';
  $('#loginError').textContent = '';
}

async function handleLogin(event) {
  event.preventDefault();
  const enteredId = $('#loginId').value.trim();
  const password = $('#loginPassword').value;
  const submit = $('#loginForm button[type="submit"]');
  const errorBox = $('#loginError');
  errorBox.textContent = '';

  if (!supabaseClient) {
    errorBox.textContent = 'Configure a URL e a chave pública do Supabase no arquivo supabase-config.js.';
    return;
  }
  if (!enteredId || !password) {
    errorBox.textContent = 'Preencha seu acesso e sua senha.';
    return;
  }

  submit.disabled = true;
  submit.textContent = 'Conectando...';
  try {
    await supabaseClient.auth.signOut().catch(() => {});

    if (state.role === 'loja') {
      const cnpj = enteredId.replace(/\D/g, '');
      if (cnpj.length !== 14) throw new Error('Digite um CNPJ com 14 números.');
      const { error: authError } = await supabaseClient.auth.signInAnonymously();
      if (authError) throw new Error(`Não foi possível iniciar a sessão da loja: ${authError.message}`);

      const { data, error } = await supabaseClient.rpc('entrar_como_loja', {
        p_cnpj: cnpj,
        p_senha: password
      });
      if (error) throw error;
      if (!data?.success) throw new Error(data?.message || 'CNPJ ou senha incorretos.');

      state.session = {
        role: 'loja',
        cnpj: data.cnpj || cnpj,
        lojaId: data.loja_id,
        displayName: data.nome || 'Sua loja'
      };
    } else {
      const { data, error } = await supabaseClient.auth.signInWithPassword({
        email: enteredId.toLowerCase(),
        password
      });
      if (error) throw new Error('E-mail ou senha incorretos. Confira os dados e tente novamente.');

      const { data: profile, error: profileError } = await supabaseClient
        .from('perfis')
        .select('id, nome, perfil')
        .eq('id', data.user.id)
        .maybeSingle();
      if (profileError) throw profileError;
      if (!profile || profile.perfil !== 'comprador') {
        await supabaseClient.auth.signOut();
        throw new Error('Este usuário não possui perfil de Comprador autorizado.');
      }
      state.session = {
        role: 'comprador',
        userId: data.user.id,
        email: data.user.email,
        displayName: profile.nome || data.user.email
      };
    }

    await loadRemoteData();
    showAuthenticatedApp();
  } catch (error) {
    console.error('Falha no login:', error);
    state.session = null;
    await supabaseClient.auth.signOut().catch(() => {});
    errorBox.textContent = error.message || 'Não foi possível entrar. Tente novamente.';
  } finally {
    submit.disabled = false;
    submit.innerHTML = 'Entrar <span>→</span>';
  }
}

async function sendBuyerPasswordRecovery() {
  const email = $('#loginId').value.trim().toLowerCase();
  const errorBox = $('#loginError');
  errorBox.textContent = '';
  if (!supabaseClient) {
    errorBox.textContent = 'Configure primeiro a conexão com o Supabase.';
    return;
  }
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    errorBox.textContent = 'Informe o e-mail do Comprador para receber o link de recuperação.';
    return;
  }
  const button = $('#forgotPasswordButton');
  button.disabled = true;
  try {
    const redirectTo = `${window.location.origin}${window.location.pathname.replace(/[^/]*$/, '')}redefinir-senha.html`;
    const { error } = await supabaseClient.auth.resetPasswordForEmail(email, { redirectTo });
    if (error) throw error;
    toast('Se o e-mail estiver cadastrado, você receberá as instruções de recuperação.');
    errorBox.textContent = 'Solicitação enviada. Verifique sua caixa de entrada e também o spam.';
  } catch (error) {
    console.error('Falha ao solicitar recuperação:', error);
    errorBox.textContent = error.message || 'Não foi possível solicitar a recuperação.';
  } finally {
    button.disabled = false;
  }
}

async function logout() {
  if (supabaseClient) await supabaseClient.auth.signOut().catch(error => console.warn('Falha ao encerrar sessão:', error));
  state.session = null;
  state.orders = [];
  state.stores = [];
  state.page = 'home';
  state.storeSelectedIds.clear();
  state.buyerSelectedIds.clear();
  $('#appView').classList.add('hidden');
  $('#loginView').classList.remove('hidden');
  $('#loginPassword').value = '';
  $('#loginError').textContent = '';
  setLoginRole('loja');
}

async function restoreSession() {
  if (!supabaseClient) return;
  try {
    const { data: { session }, error } = await supabaseClient.auth.getSession();
    if (error) throw error;
    if (!session) return;

    const { data: profile, error: profileError } = await supabaseClient
      .from('perfis')
      .select('id, nome, perfil, loja_id')
      .eq('id', session.user.id)
      .maybeSingle();
    if (profileError) throw profileError;

    if (profile?.perfil === 'comprador' && !session.user.is_anonymous) {
      state.session = {
        role: 'comprador',
        userId: session.user.id,
        email: session.user.email,
        displayName: profile.nome || session.user.email
      };
    } else if (profile?.perfil === 'loja' && session.user.is_anonymous) {
      const { data: store, error: storeError } = await supabaseClient
        .from('lojas')
        .select('id, cnpj, nome')
        .eq('id', profile.loja_id)
        .maybeSingle();
      if (storeError) throw storeError;
      if (!store) throw new Error('Cadastro da loja não encontrado.');
      state.session = { role: 'loja', cnpj: store.cnpj, lojaId: store.id, displayName: store.nome };
    } else {
      await supabaseClient.auth.signOut();
      return;
    }

    await loadRemoteData();
    showAuthenticatedApp();
  } catch (error) {
    console.error('Falha ao restaurar sessão:', error);
    await supabaseClient.auth.signOut().catch(() => {});
  }
}

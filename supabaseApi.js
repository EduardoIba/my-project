const usernamePattern = /^[a-z0-9][a-z0-9._-]{0,62}[a-z0-9]$/;

export function loginAlias(username) {
  const normalized = String(username ?? '')
    .trim()
    .toLowerCase();
  if (!usernamePattern.test(normalized)) return null;
  return normalized + '@login.importlaser.invalid';
}

export function createSupabaseApi(url, key, accessToken) {
  async function request(path, { body, token = accessToken, ...options } = {}) {
    const response = await fetch(new URL(path, url), {
      ...options,
      method: options.method || (body === undefined ? 'GET' : 'POST'),
      headers: {
        apikey: key,
        ...(token && { Authorization: `Bearer ${token}` }),
        'Content-Type': 'application/json',
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const data = await response.json().catch(() => null);
    if (!response.ok) {
      throw Object.assign(
        new Error(
          data?.message ||
            data?.msg ||
            data?.error_description ||
            `Supabase: HTTP ${response.status}`,
        ),
        {
          status: response.status,
          retryAfter: response.headers.get('Retry-After'),
        },
      );
    }
    return data;
  }

  return {
    async signIn(username, password) {
      const email = loginAlias(username);
      if (!email || typeof password !== 'string' || !password)
        throw new Error('Usuário ou senha inválidos.');
      try {
        return await request('/auth/v1/token?grant_type=password', {
          token: null,
          body: { email, password },
        });
      } catch (error) {
        if (error.status === 429) {
          const seconds = Number(error.retryAfter) || 60;
          throw Object.assign(new Error('Muitas tentativas. Aguarde antes de tentar novamente.'), {
            waitSeconds: Math.min(900, Math.max(1, seconds)),
          });
        }
        throw new Error(
          error.status && error.status < 500
            ? 'Usuário ou senha inválidos.'
            : 'Não foi possível entrar. Tente novamente em instantes.',
        );
      }
    },
    refresh: (refreshToken) =>
      request('/auth/v1/token?grant_type=refresh_token', {
        token: null,
        body: { refresh_token: refreshToken },
      }),
    signOut: () => request('/auth/v1/logout?scope=local', { method: 'POST' }),
    rpc: (name, body = {}, query) =>
      request(`/rest/v1/rpc/${name}${query ? '?' + new URLSearchParams(query) : ''}`, { body }),
    select: (table, query) => request(`/rest/v1/${table}?${new URLSearchParams(query)}`),
  };
}

import { api } from './client';
export async function login(payload) {
    const { data } = await api.post('/auth/login', payload);
    return data;
}

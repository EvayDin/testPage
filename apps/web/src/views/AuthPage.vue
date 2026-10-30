<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { loginSchema, registerSchema, type AuthResponse } from '@mvp/shared';
import { auth, request } from '../api';
const route = useRoute();
const router = useRouter();
const isRegister = computed(() => route.path === '/register');
const name = ref('');
const email = ref('');
const password = ref('');
const showPassword = ref(false);
const busy = ref(false);
const error = ref('');
watch(isRegister, () => { error.value = ''; password.value = ''; });
async function submit() {
  if (busy.value) return;
  error.value = '';
  const data = { name: name.value, email: email.value, password: password.value };
  const parsed = (isRegister.value ? registerSchema : loginSchema).safeParse(data);
  if (!parsed.success) { error.value = parsed.error.issues[0].message; return; }
  busy.value = true;
  try {
    auth.user = (await request<AuthResponse>(isRegister.value ? 'register' : 'login', parsed.data)).user;
    await router.push('/');
  } catch (cause) { error.value = cause instanceof Error ? cause.message : '操作失败，请重试'; }
  finally { busy.value = false; }
}
</script>

<template>
  <div class="auth-layout">
    <aside class="story-panel">
      <a class="brand brand-light" href="/"> <span class="brand-icon">L<span>•</span></span> launchpad<span class="brand-dot">®</span></a>
      <div class="story-copy">
        <div class="eyebrow light"><span class="status-dot"></span> A LITTLE START. A BIG POSSIBILITY.</div>
        <h1>每一个想法，<br>都值得一个<span class="serif-accent">起点。</span></h1>
        <p>从这里开始，把可能变成日常。<br>一个属于你的空间，准备好了。</p>
      </div>
      <div class="orbit-art" aria-hidden="true"><div class="orbit orbit-one"></div><div class="orbit orbit-two"></div><div class="orbit orbit-three"></div><div class="art-sphere"></div><span class="art-star">✳</span><span class="art-label">MAKE ROOM FOR WHAT’S NEXT</span><div class="art-card"><span>↗</span><div>新的开始<small>就在此刻</small></div></div></div>
      <div class="story-footer"><span>为下一步而生。</span><span>EST. 2026 ↗</span></div>
    </aside>
    <main class="auth-main">
      <div class="top-note">{{ isRegister ? '已经有账号了？' : '第一次来到这里？' }} <RouterLink :to="isRegister ? '/login' : '/register'">{{ isRegister ? '登录账号' : '创建账号' }} <span>↗</span></RouterLink></div>
      <section class="auth-form-wrap">
        <div class="form-kicker">YOUR NEXT CHAPTER</div>
        <h2>{{ isRegister ? '开启新的可能' : '很高兴，再见到你' }}<span class="heading-dot">.</span></h2>
        <p class="form-description">{{ isRegister ? '创建你的账号，让好想法有个落脚的地方。' : '登录你的账号，继续探索属于你的可能。' }}</p>
        <form @submit.prevent="submit">
          <div v-if="isRegister" class="field"><label for="name">你的名字</label><input id="name" v-model="name" autocomplete="name" placeholder="怎么称呼你？" maxlength="40" required :disabled="busy"></div>
          <div class="field"><label for="email">邮箱地址</label><input id="email" v-model="email" type="email" autocomplete="email" placeholder="you@example.com" maxlength="254" required :disabled="busy"></div>
          <div class="field"><label for="password">密码 <span>{{ isRegister ? '至少 8 位字符' : '欢迎回来' }}</span></label><div class="password-field"><input id="password" v-model="password" :type="showPassword ? 'text' : 'password'" :autocomplete="isRegister ? 'new-password' : 'current-password'" placeholder="输入你的密码" minlength="8" maxlength="128" required :disabled="busy"><button class="password-toggle" type="button" :aria-label="showPassword ? '隐藏密码' : '显示密码'" :aria-pressed="showPassword" @click="showPassword = !showPassword">{{ showPassword ? '隐藏' : '显示' }}</button></div></div>
          <div v-if="error" class="error-message" role="alert">{{ error }}</div>
          <button class="primary-button" type="submit" :disabled="busy">{{ busy ? '请稍候…' : isRegister ? '创建账号' : '登录' }}<span v-if="!busy">↗</span></button>
        </form>
        <div class="form-footnote"><span class="tiny-lock">◇</span> 你的信息，只属于你。安全连接，安心开始。</div>
      </section>
      <footer class="auth-footer"><span>© {{ new Date().getFullYear() }} Launchpad</span><span>Small steps, new horizons.</span></footer>
    </main>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import { useRouter } from 'vue-router';
import { auth, request } from '../api';
const router = useRouter();
const busy = ref(false);
const error = ref('');
const createdDate = computed(() => auth.user ? new Date(auth.user.createdAt).toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' }) : '');
async function signOut() {
  busy.value = true;
  error.value = '';
  try { await request('logout', {}); auth.user = null; await router.replace('/login'); }
  catch (cause) { error.value = cause instanceof Error ? cause.message : '退出失败，请重试'; }
  finally { busy.value = false; }
}
</script>

<template>
  <div class="dashboard" v-if="auth.user">
    <header class="dashboard-header"><RouterLink class="brand" to="/"><span class="brand-icon">L<span>•</span></span> launchpad<span class="brand-dot">®</span></RouterLink><div class="header-actions"><span class="workspace-tag">个人空间</span><span class="avatar avatar-small">{{ auth.user.name.slice(0, 1).toUpperCase() }}</span><button class="logout-button" :disabled="busy" @click="signOut">{{ busy ? '退出中…' : '退出登录' }} <span>↗</span></button></div></header>
    <main class="dashboard-main">
      <div v-if="error" class="error-message" role="alert">{{ error }}</div>
      <div class="dashboard-eyebrow"><span class="status-dot"></span> YOUR PERSONAL SPACE <span class="today">{{ new Date().toLocaleDateString('zh-CN', { month: 'long', day: 'numeric', weekday: 'long' }) }}</span></div>
      <section class="welcome-banner"><div class="welcome-copy"><span class="pill">一切就绪，欢迎加入</span><h1>你好，{{ auth.user.name }}<span class="heading-dot">.</span><br>新的可能，从这里开始。</h1><p>这是属于你的个人主页。<br>放轻松，好好享受每一次新的开始。</p><div class="welcome-bottom"><span class="mini-circle">✓</span> 已安全登录 <span class="welcome-divider">/</span> 很高兴你在这里</div></div><div class="home-art" aria-hidden="true"><div class="home-orbit"></div><div class="home-orbit second"></div><div class="home-sphere"></div><span>✳</span><div class="home-art-caption">HELLO,<br>NEW BEGINNINGS.</div></div></section>
      <div class="section-title"><h2>你的账号</h2><span>THE ESSENTIALS</span></div>
      <section class="account-grid"><article class="account-card profile-card"><div class="card-top"><span>01 / 个人信息</span><span>↗</span></div><div class="profile-info"><div class="avatar">{{ auth.user.name.slice(0, 1).toUpperCase() }}</div><div><h3>{{ auth.user.name }}</h3><p>{{ auth.user.email }}</p></div></div><div class="card-bottom"><span>账号状态</span><span class="active-state"><span class="status-dot"></span> 正常使用中</span></div></article><article class="account-card"><div class="card-top"><span>02 / 加入时间</span><span>◷</span></div><div class="date-value">{{ createdDate }}</div><p class="muted">每一段旅程，都有值得记住的第一天。</p><div class="card-bottom"><span>你的旅程</span><span>已经开始 ↗</span></div></article><article class="account-card note-card"><span class="note-star">✳</span><h3>不必等到万事俱备，<br>开始，就是好事。</h3><span class="note-caption">A SMALL NOTE FOR TODAY</span></article></section>
    </main><footer class="dashboard-footer"><span>© {{ new Date().getFullYear() }} Launchpad</span><span>一步一步，走向新的可能。 ↗</span></footer>
  </div>
</template>

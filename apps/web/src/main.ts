import { createApp } from 'vue';
import { createRouter, createWebHistory } from 'vue-router';
import App from './App.vue';
import AuthPage from './views/AuthPage.vue';
import HomePage from './views/HomePage.vue';
import { auth, refreshUser } from './api';
import './style.css';

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', component: HomePage, meta: { protected: true } },
    { path: '/login', component: AuthPage },
    { path: '/register', component: AuthPage },
    { path: '/:pathMatch(.*)*', redirect: '/' },
  ],
});
router.beforeEach(async (to) => {
  try { await refreshUser(); } catch { return to.meta.protected ? '/login' : true; }
  if (to.meta.protected && !auth.user) return '/login';
  if (!to.meta.protected && auth.user) return '/';
});
createApp(App).use(router).mount('#app');

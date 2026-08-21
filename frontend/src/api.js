import axios from "axios";

export const API_BASE_URL = import.meta.env.VITE_API_URL || (window.location.hostname === "localhost" ? "http://localhost:5000" : "https://vedha-billing.onrender.com");

const api = axios.create({
  baseURL: API_BASE_URL,
  timeout: 25000
});

let wakeupListeners = [];

export function onServerWakeupNeeded(listener) {
  wakeupListeners.push(listener);
  return () => {
    wakeupListeners = wakeupListeners.filter(l => l !== listener);
  };
}

function triggerWakeup() {
  wakeupListeners.forEach(listener => {
    try { listener(); } catch (e) { console.error(e); }
  });
}

api.interceptors.response.use(
  (response) => response,
  (error) => {
    const status = error.response ? error.response.status : null;
    const isNetworkOrWakeupError = !error.response || status === 502 || status === 503 || status === 504 || error.code === "ECONNABORTED" || error.code === "ERR_NETWORK";
    if (isNetworkOrWakeupError) {
      triggerWakeup();
    }
    return Promise.reject(error);
  }
);

export function setAuthToken(token) {
  if (token) {
    api.defaults.headers.common.Authorization = `Bearer ${token}`;
  } else {
    delete api.defaults.headers.common.Authorization;
  }
}

export default api;

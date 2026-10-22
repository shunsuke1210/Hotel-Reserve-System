// 宿泊客アプリの起動
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App, createGuestApp } from './app';
import './styles.css';

const container = document.getElementById('root');
if (!container) throw new Error('画面を表示する要素（#root）がありません');

createRoot(container).render(
  <StrictMode>
    <App app={createGuestApp()} />
  </StrictMode>,
);

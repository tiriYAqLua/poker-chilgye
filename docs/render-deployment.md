# Развёртывание без карты: Render + Neon

1. Создайте пустой репозиторий GitHub и отправьте в него содержимое проекта.
   Не отправляйте `.env`, `snapshot.key` или SQLite-файл.
2. В Render выберите **New → Blueprint**, подключите репозиторий и подтвердите
   найденный `render.yaml`. Проверьте, что выбран `Free`, а не Starter.
3. В Neon откройте проект `poker-friends`. Возьмите **direct** URL базы
   `neondb`, временно задайте его как `DATABASE_URL_UNPOOLED` и из папки
   проекта выполните `pnpm.cmd migrate:postgres`. Затем для приложения
   возьмите обычный **pooled** `DATABASE_URL`.
4. В Render → Environment задайте:
   - `DATABASE_URL` — pooled URL из Neon;
   - `POKER_SNAPSHOT_KEY` — Render создаст его сам как постоянный секрет
     (не заменяйте это значение при следующих deploy).
   `POKER_ORIGIN` подставится автоматически из публичного URL Render.
5. После первого деплоя откройте `/health`, затем сайт в двух разных браузерах
   (или в обычном окне и инкогнито), создайте комнату, зайдите по коду и
   завершите раздачу. Проверьте, что баланс сохраняется после redeploy.

Google-вход необязателен. Если он нужен, добавьте `GOOGLE_CLIENT_ID` и
`GOOGLE_CLIENT_SECRET` в Render и зарегистрируйте callback
`<POKER_ORIGIN>/api/auth/google/callback` в Google Cloud.

Это один экземпляр приложения: не включайте горизонтальное масштабирование,
пока комнаты, таймеры и Socket.IO не вынесены в общий Redis-слой.

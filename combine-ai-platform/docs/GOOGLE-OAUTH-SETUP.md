# Google OAuth 設定指南（新建 GCP 專案）

當舊專案被停用（`disabled_client`）或申訴未通過時，用**新的 Google 帳號**建立全新 GCP 專案，再更新 `.env` 即可恢復 Google 登入與 Gmail 連線。

> **建議**：使用與被封專案**不同的 Google 帳號**建立新專案，降低再次被連帶停用的風險。

---

## 1. 建立 GCP 專案

1. 開啟 [Google Cloud Console](https://console.cloud.google.com/)
2. 左上角專案選單 → **新增專案 (New Project)**
3. 專案名稱例如：`Combine AI Platform Dev`
4. 建立後，確認右上角已選中此新專案

---

## 2. 啟用 API

前往 [API Library](https://console.cloud.google.com/apis/library)，搜尋並 **Enable**：

| API | 用途 |
|-----|------|
| **Gmail API** | 收信、同步、發信 |
| **Google People API** | （可選）使用者 profile |

---

## 3. 設定 OAuth 同意畫面

前往 [OAuth consent screen](https://console.cloud.google.com/apis/credentials/consent)

| 欄位 | 建議值 |
|------|--------|
| User type | **External**（個人 Gmail 測試） |
| App name | `Combine AI Platform` |
| User support email | 你的 Gmail |
| Developer contact | 你的 Gmail |
| App domain | 可留空（localhost 開發） |

### 3.1 加入 Scopes

點 **Add or remove scopes**，加入：

```
openid
email
profile
https://www.googleapis.com/auth/gmail.modify
https://www.googleapis.com/auth/gmail.send
https://www.googleapis.com/auth/userinfo.email
```

### 3.2 Test users（必須）

Publishing status 保持 **Testing**，在 **Test users** 加入所有會測試的 Gmail，例如：

- `mickeyliao67@gmail.com`
- 隊友 Gmail（每人都要加）

未加入 Test users 的帳號會看到 `access_denied`。

---

## 4. 建立 OAuth Client ID

前往 [Credentials](https://console.cloud.google.com/apis/credentials) → **Create Credentials** → **OAuth client ID**

| 欄位 | 值 |
|------|-----|
| Application type | **Web application** |
| Name | `Combine AI Local Dev` |

### Authorized redirect URIs（兩個都要加，完全一致）

```
http://localhost:3000/api/auth/google/callback
http://localhost:3000/api/email/integrations?action=callback
```

> ⚠️ 第二個 URI 是 `email/integrations?action=callback`，不是 `integrations/google/callback`。

建立後複製：

- **Client ID** → `GOOGLE_CLIENT_ID`
- **Client secret** → `GOOGLE_CLIENT_SECRET`

---

## 5. 更新 `.env`

在 `combine-ai-platform/.env` 更新（或從 `.env.example` 複製後填入）：

```env
GOOGLE_CLIENT_ID="你的新-client-id.apps.googleusercontent.com"
GOOGLE_CLIENT_SECRET="GOCSPX-你的新-secret"
GOOGLE_AUTH_REDIRECT_URI="http://localhost:3000/api/auth/google/callback"
GOOGLE_OAUTH_REDIRECT_URI="http://localhost:3000/api/email/integrations?action=callback"
GOOGLE_OAUTH_STATE_SECRET="隨機長字串-建議改"
```

**不要** commit `.env` 到 git。隊友各自在本機 `.env` 填入同一組 credentials（Testing 模式可共用）。

---

## 6. 啟動並測試

```bash
cd combine-ai-platform
docker compose up -d postgres
npm run db:seed          # 若 DB 是新的
npm run dev
```

### 測試流程

1. 開啟 http://localhost:3000/login
2. 點 **Continue with Google**
3. 用已加入 Test users 的 Gmail 登入
4. 同意所有權限（含 Gmail）
5. 應跳轉到 `/email?gmail=connected`
6. Email Agent → Settings → Gmail 應顯示 **Connected**

### 常見錯誤

| 錯誤 | 原因 | 解法 |
|------|------|------|
| `disabled_client` | Client 被停用 | 確認用的是**新專案**的新 credentials |
| `redirect_uri_mismatch` | Redirect URI 不一致 | 對照第 4 步，Console 與 `.env` 必須完全相同 |
| `access_denied` | 不在 Test users | 到 OAuth consent screen 加入該 Gmail |
| `Gmail permissions not granted` | 未勾選 Gmail scope | 重新登入，同意全部權限；或檢查 consent screen scopes |

---

## 7. 給隊友的 checklist

- [ ] 拉最新 `dev` branch
- [ ] `npm install`
- [ ] 複製 `.env.example` → `.env`，填入新的 `GOOGLE_CLIENT_ID` / `SECRET`
- [ ] 確認自己的 Gmail 已在 GCP **Test users**
- [ ] `docker compose up -d postgres` + `npm run dev`

---

## 8. 上線前（Production）

Testing 模式最多 100 個 test users。正式環境需要：

1. OAuth consent screen → **Publish app**
2. 提交 **Google OAuth verification**（Gmail 敏感 scope 必審）
3. 新增 production redirect URI（例如 `https://your-domain.com/api/auth/google/callback`）
4. 設定 `COOKIE_SECURE="true"`

---

## 相關程式位置

| 功能 | 路徑 |
|------|------|
| Google 登入開始 | `apps/web/src/app/api/auth/google/start/route.ts` |
| Google 登入回調 + 自動連 Gmail | `apps/web/src/app/api/auth/google/callback/route.ts` |
| Email Agent 手動 Connect | `apps/web/src/app/api/email/integrations/route.ts` |
| OAuth 共用邏輯 | `apps/web/src/lib/server/google-oauth.ts` |

# SpaceNovaX Server + Telegram Bot + Admin Dashboard v3

## 포함 기능
- 관리자 대시보드
- Telegram 봇 `/start`
- SNP 채굴 버튼: 24시간마다 +100 SNP
- 미션 보상
  - Website Visit: 기본 +100 SNP
  - Telegram Join: 기본 +200 SNP
  - YouTube Subscribe: 기본 +300 SNP
  - Discord Join: 기본 +300 SNP
  - X Follow: 기본 +300 SNP
- 추천인 코드: 추천인 +500 SNP
- Solana 지갑 등록
- 랭킹
- CSV 다운로드

## Render Environment Variables
필수:
- `BOT_TOKEN` = BotFather 봇 토큰

권장:
- `ADMIN_KEY` = 관리자 키
- `APP_URL` = Render 주소
- `WEBSITE_URL` = 웹사이트 주소
- `TELEGRAM_URL` = 텔레그램 주소
- `YOUTUBE_URL` = 유튜브 주소
- `DISCORD_URL` = 디스코드 주소
- `X_URL` = X 주소

보상 수정 가능:
- `REWARD_WEBSITE`
- `REWARD_TELEGRAM`
- `REWARD_YOUTUBE`
- `REWARD_DISCORD`
- `REWARD_X`

## Render 설정
- Build Command: `npm install`
- Start Command: `npm start`
- Root Directory: 비워둠

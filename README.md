# Discord Bot Portfolio

## 1. 프로젝트 소개

이 프로젝트는 다양한 API를 활용하여 사용자에게 다채로운 정보와 재미를 제공하는 다기능 Discord 봇입니다. 게임 전적 조회부터 실용적인 정보 검색, 그리고 재미있는 운세 기능까지, 사용자의 Discord 경험을 한층 더 풍부하게 만들어줍니다.

## 2. 주요 기능

- **게임 전적 조회**:
    - **배틀그라운드(PUBG)**: 카카오 및 스팀 플랫폼의 랭크 전적을 조회합니다.
    - **발로란트**: 라이엇 ID와 태그라인으로 플레이어의 상세 경쟁전 정보를 제공합니다.
    - **TFT (전략적 팀 전투)**: 챔피언별 추천 아이템 조합을 조회합니다.
    - **FC 온라인**: 닉네임으로 유저의 최고 등급 정보를 조회합니다.
- **스포츠 정보**:
    - **축구**: 팀명을 입력하면 해당 팀의 정보, 순위, 그리고 다가오는 경기 일정을 보여줍니다.
- **실용 정보**:
    - **맛집 추천**: 특정 지역의 맛집을 랜덤으로 추천받고, 다른 맛집을 계속 추천받을 수 있습니다.
    - **날씨**: 지역별 현재 날씨, 기온, 습도, 대기질 정보를 제공합니다.
- **커뮤니티 기능**:
    - **게임 모집**: 특정 시간에 게임할 인원을 모집하고, 참가자들에게 자동으로 알림을 보냅니다.
    - **GGCK어 사전**: 서버 내에서 사용하는 은어나 신조어를 등록하고 검색할 수 있는 기능입니다. (서버 관리자 전용 등록 기능 포함)
- **재미 기능**:
    - **오늘의 운세**: 사용자별로 매일 다른 운세를 제공하며, 특별한 등급(태초, 존망)에 따라 화려한 이펙트가 나타납니다.

## 3. 기술 스택

- **언어**: JavaScript (Node.js)
- **라이브러리 및 프레임워크**:
    - `discord.js`: Discord 봇 개발을 위한 핵심 라이브러리
    - `axios`: 외부 API와의 HTTP 통신
    - `dotenv`: 환경 변수 관리
- **데이터베이스**:
    - `firebase-admin`: Firebase Firestore를 사용한 데이터 저장 및 관리 (GGCK어 사전, TFT 아이템 통계 등)
- **외부 API**:
    - Riot Games API (TFT)
    - PUBG API
    - Nexon API (FC 온라인)
    - OpenWeatherMap API (날씨)
    - Naver Search API (맛집 추천)
    - Football-Data.org API (축구 정보)
    - Tracker.gg API (발로란트)

## 4. 설치 및 실행 방법

1.  **레포지토리 클론**:
    ```bash
    git clone https://github.com/your-username/discord-bot.git
    cd discord-bot
    ```

2.  **의존성 설치**:
    ```bash
    npm install
    ```

3.  **환경 변수 설정**:
    - `.env` 파일을 프로젝트 루트에 생성하고, 아래의 API 키와 토큰을 입력합니다.
    ```
    DISCORD_TOKEN=your_discord_bot_token
    PUBG_API_KEY=your_pubg_api_key
    FOOTBALL_API_KEY=your_football_api_key
    FCONLINE_API_KEY=your_fconline_api_key
    RIOT_API_KEY=your_riot_api_key
    NAVER_CLIENT_ID=your_naver_client_id
    NAVER_CLIENT_SECRET=your_naver_client_secret
    OPENWEATHER_API_KEY=your_openweathermap_api_key
    TRACKERGG_API_KEY=your_trackergg_api_key

    # Firebase Admin SDK
    FIREBASE_TYPE=service_account
    FIREBASE_PROJECT_ID=your_firebase_project_id
    FIREBASE_PRIVATE_KEY_ID=your_firebase_private_key_id
    FIREBASE_PRIVATE_KEY="your_firebase_private_key"
    FIREBASE_CLIENT_EMAIL=your_firebase_client_email
    FIREBASE_CLIENT_ID=your_firebase_client_id
    FIREBASE_AUTH_URI=https://accounts.google.com/o/oauth2/auth
    FIREBASE_TOKEN_URI=https://oauth2.googleapis.com/token
    FIREBASE_AUTH_PROVIDER_CERT_URL=https://www.googleapis.com/oauth2/v1/certs
    FIREBASE_CLIENT_CERT_URL=your_firebase_client_cert_url
    ```

4.  **봇 실행**:
    - **일반 실행**:
      ```bash
      npm start
      ```
    - **개발 모드 (nodemon 사용)**:
      ```bash
      npm run dev
      ```

## 5. 사용 가능한 명령어

- `/배그 [닉네임] [플랫폼] [모드]`: 배틀그라운드 랭크 전적을 조회합니다.
- `/발로란트 [라이엇아이디] [태그라인]`: 발로란트 플레이어 정보를 조회합니다.
- `/축구 [팀명]`: 축구 팀 정보를 조회합니다.
- `/피파 [닉네임]`: FC 온라인 사용자 정보를 조회합니다.
- `/tft아이템 [챔피언]`: TFT 챔피언의 추천 아이템을 조회합니다.
- `/맛집추천 [지역]`: 주변 맛집을 추천받습니다.
- `/게임모집 [게임] [인원] [설명] [시] [분] [전체알림]`: 게임 참가자를 모집합니다.
- `/ggck어사전 검색 [단어]`: GGCK어 사전에서 단어를 검색합니다.
- `/ggck어사전 목록`: GGCK어 사전 전체 목록을 확인합니다.
- `/ggck어등록 [단어] [의미] [예문] [분류] [창시자]`: (관리자 전용) 새로운 GGCK어를 등록합니다.
- `/날씨 [지역]`: 해당 지역의 현재 날씨를 확인합니다.
- `/운세`: 오늘의 운세를 확인합니다.

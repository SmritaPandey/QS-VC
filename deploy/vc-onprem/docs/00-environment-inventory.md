# P0 configuration-name inventory

Generated from tracked source and deployment templates. Names and source locations
only; no private environment files or secret values were read. This is a discovery
index, not the P2 configuration reference. Dynamic property access, shell-only variables,
CLI flags and provider-generated settings require reconciliation during P1/P2.
Build-time VITE_* values are public browser configuration and must never contain secrets.
OS process settings and deployment-specific names may appear beside application settings.
Defaults, validation rules and enabled-profile requirements remain to be reconciled.

257 distinct names discovered.

| Name | Source owners (first three locations) |
|---|---|
| `AI_DOMAIN` | `deploy/e2e/.env.example:2`; `deploy/e2e/compose.yml:64` |
| `ALLOWED_IPS` | `deploy/e2e/.env.example:4`; `deploy/e2e/compose.yml:65` |
| `ASR_API_KEY` | `deploy/aws/.env.example:66`; `deploy/aws/compose.yml:174`; `deploy/aws/cpu/.env.example:3`; +10 locations |
| `ASR_BASE_IMAGE` | `deploy/aws/gpu/compose.yml:24`; `docker-compose.prod.yml:378` |
| `ASR_BEAM_SIZE` | `deploy/aws/cpu/compose.yml:29`; `services/asr/app.py:83` |
| `ASR_COMPUTE_TYPE` | `services/asr/app.py:80` |
| `ASR_CPU_THREADS` | `services/asr/app.py:82` |
| `ASR_DEVICE` | `services/asr/app.py:78` |
| `ASR_DISABLE_AUTOLOAD` | `services/asr/app.py:441`; `services/asr/test_app.py:4` |
| `ASR_END_SILENCE_MS` | `deploy/aws/cpu/compose.yml:32` |
| `ASR_ENGINE` | `deploy/aws/gpu/.env.example:8`; `deploy/aws/gpu/compose.yml:27`; `deploy/e2e/.env.example:10`; +5 locations |
| `ASR_INDIC_DEVICE` | `services/asr/app.py:129` |
| `ASR_INDIC_FINAL_DECODER` | `services/asr/app.py:135` |
| `ASR_INDIC_LANGUAGES` | `deploy/aws/gpu/compose.yml:32`; `deploy/e2e/compose.yml:29`; `docker-compose.prod.yml:390`; +1 locations |
| `ASR_INDIC_MODEL` | `deploy/aws/gpu/compose.yml:30`; `docker-compose.prod.yml:385`; `services/asr/app.py:127` |
| `ASR_INDIC_PARTIAL_DECODER` | `services/asr/app.py:136` |
| `ASR_LANGUAGES` | `deploy/aws/cpu/.env.example:7`; `deploy/aws/cpu/compose.yml:34`; `deploy/aws/gpu/compose.yml:31`; +3 locations |
| `ASR_MAX_PARALLEL` | `deploy/aws/gpu/.env.example:10`; `deploy/aws/gpu/compose.yml:34`; `deploy/e2e/.env.example:12`; +2 locations |
| `ASR_MAX_SESSIONS` | `deploy/aws/compose.yml:175`; `services/signaling/src/asr-relay.ts:38` |
| `ASR_MAX_UTTERANCE_S` | `deploy/aws/cpu/compose.yml:33` |
| `ASR_MODEL` | `deploy/aws/cpu/.env.example:6`; `deploy/aws/cpu/compose.yml:26`; `deploy/aws/gpu/.env.example:9`; +5 locations |
| `ASR_MODEL_DIR` | `services/asr/app.py:81` |
| `ASR_ONNX_RUNTIME` | `deploy/aws/gpu/compose.yml:25`; `docker-compose.prod.yml:379` |
| `ASR_PARTIAL_INTERVAL_MS` | `deploy/aws/cpu/compose.yml:31` |
| `ASR_PROMPT` | `deploy/aws/cpu/compose.yml:35`; `deploy/aws/gpu/.env.example:11`; `deploy/aws/gpu/compose.yml:33`; +3 locations |
| `ASR_URL` | `config/.env.onprem.template:92`; `deploy/aws/.env.example:65`; `deploy/aws/compose.yml:173`; +2 locations |
| `AUTH_DATABASE_URL` | `deploy/aws/.env.example:6`; `deploy/aws/compose.yml:77`; `services/auth/src/index.ts:140` |
| `AUTH_DB_PASSWORD` | `config/.env.onprem.template:109`; `docker-compose.prod.yml:233` |
| `AUTH_DB_USER` | `config/.env.onprem.template:108`; `docker-compose.prod.yml:232` |
| `AUTH_INTERNAL_URL` | `deploy/aws/.env.example:44`; `services/meeting/src/index.ts:149`; `services/recording/src/app.ts:26`; +4 locations |
| `AUTH_PORT` | `deploy/aws/.env.example:40`; `services/auth/src/index.ts:124` |
| `AUTH_PUBLIC_URL` | `config/.env.onprem.template:13`; `config/.env.onprem.template:40`; `deploy/aws/.env.example:18`; +4 locations |
| `AWS_REGION` | `services/recording/src/storage.ts:20` |
| `BRIDGE_API_TOKEN` | `compose/mcu.yml:17`; `compose/mcu.yml:18`; `compose/single-box.yml:288`; +5 locations |
| `BRIDGE_LEG_VIDEO_CODEC` | `deploy/poly-bridge/.env.example:13` |
| `BRIDGE_RTP_ANNOUNCED_IP` | `deploy/poly-bridge/.env.example:3` |
| `BRIDGE_RTP_LISTEN_IP` | `deploy/poly-bridge/.env.example:2` |
| `BRIDGE_SITE` | `deploy/poly-bridge/.env.example:1` |
| `BRIDGE_SRTP` | `deploy/poly-bridge/.env.example:12` |
| `CAPTION_GLOBAL_CONCURRENCY` | `deploy/aws/compose.yml:181` |
| `CAPTION_MAX_ROOMS` | `deploy/aws/compose.yml:179` |
| `CAPTION_ROOM_CONCURRENCY` | `deploy/aws/compose.yml:180` |
| `CAPTION_TRANSLATION_PROVIDER` | `config/.env.onprem.template:90`; `deploy/aws/.env.example:67`; `deploy/aws/compose.yml:168`; +3 locations |
| `CASHFREE_API_VERSION` | `config/.env.onprem.template:58`; `deploy/aws/.env.example:36`; `deploy/aws/compose.yml:124`; +2 locations |
| `CASHFREE_CLIENT_ID` | `config/.env.onprem.template:59`; `deploy/aws/.env.example:37`; `deploy/aws/compose.yml:125`; +3 locations |
| `CASHFREE_CLIENT_SECRET` | `config/.env.onprem.template:60`; `deploy/aws/.env.example:38`; `deploy/aws/compose.yml:126`; +4 locations |
| `CASHFREE_ENVIRONMENT` | `config/.env.onprem.template:57`; `deploy/aws/.env.example:35`; `deploy/aws/compose.yml:123`; +5 locations |
| `CASHFREE_WEBHOOK_SECRET` | `config/.env.onprem.template:61`; `deploy/aws/.env.example:39`; `deploy/aws/compose.yml:127`; +2 locations |
| `CORS_ORIGINS` | `config/.env.onprem.template:14`; `deploy/aws/.env.example:3`; `deploy/aws/compose.yml:15`; +9 locations |
| `DATABASE_URL` | `services/auth/scripts/create-demo-accounts.cjs:10`; `services/auth/scripts/create-platform-admins.cjs:13`; `services/auth/src/index.ts:140`; +1 locations |
| `DB_APPLICATION_NAME` | `deploy/aws/.env.example:13` |
| `DEMO_CREDENTIALS_FILE` | `services/auth/scripts/create-demo-accounts.cjs:13` |
| `DOMAIN` | `config/.env.onprem.template:10`; `deploy/aws/.env.example:1`; `deploy/aws/compose.yml:217`; +18 locations |
| `DRACHTIO_HOST` | `deploy/poly-bridge/.env.example:9` |
| `DRACHTIO_PORT` | `deploy/poly-bridge/.env.example:10` |
| `DRACHTIO_SECRET` | `compose/mcu.yml:25`; `compose/mcu.yml:40`; `deploy/poly-bridge/.env.example:11`; +1 locations |
| `ENABLE_ONPREM_GOOGLE_TRANSLATION` | `config/.env.onprem.template:93`; `services/signaling/src/captions.ts:50`; `services/signaling/src/translation.ts:24` |
| `ENTERPRISE_ACCESS_JSON` | `deploy/aws/.env.example:58`; `deploy/aws/compose.yml:78`; `services/auth/src/enterprise-access.ts:171` |
| `ENTERPRISE_LINUX_X64_INSTALLER` | `services/auth/src/enterprise-access.ts:206`; `services/auth/src/enterprise-access.ts:248` |
| `ENTERPRISE_MACOS_ARM64_INSTALLER` | `services/auth/src/enterprise-access.ts:204`; `services/auth/src/enterprise-access.ts:246` |
| `ENTERPRISE_MACOS_X64_INSTALLER` | `services/auth/src/enterprise-access.ts:205`; `services/auth/src/enterprise-access.ts:247` |
| `ENTERPRISE_WINDOWS_INSTALLER` | `services/auth/src/enterprise-access.ts:203`; `services/auth/src/enterprise-access.ts:245` |
| `FS_CONF_PROFILE` | `deploy/poly-bridge/.env.example:8` |
| `FS_ESL_HOST` | `compose/mcu.yml:20`; `config/.env.onprem.template:85`; `deploy/poly-bridge/.env.example:5` |
| `FS_ESL_PASSWORD` | `compose/mcu.yml:22`; `compose/single-box.yml:267`; `compose/single-box.yml:287`; +2 locations |
| `FS_ESL_PORT` | `compose/mcu.yml:21`; `compose/single-box.yml:268`; `config/.env.onprem.template:86`; +1 locations |
| `FS_SIP_HOST` | `compose/mcu.yml:23`; `deploy/poly-bridge/.env.example:4` |
| `GOOGLE_TRANSLATE_API_KEY` | `deploy/aws/compose.yml:169`; `docker-compose.prod.yml:177`; `services/signaling/src/captions.ts:272`; +1 locations |
| `HF_TOKEN` | `deploy/aws/gpu/.env.example:7`; `deploy/aws/gpu/compose.yml:36`; `deploy/e2e/.env.example:9`; +3 locations |
| `HOST` | `services/meeting/src/index.ts:1210`; `services/signaling/src/index.ts:158` |
| `HYBRID_MODE` | `services/signaling/src/config.ts:18` |
| `INTERNAL_AUTH_SECRET` | `compose/core.yml:102`; `compose/core.yml:148`; `compose/core.yml:172`; +10 locations |
| `INVITATION_SECRET` | `compose/core.yml:150`; `compose/core.yml:174`; `compose/single-box.yml:147`; +6 locations |
| `JWT_EXPIRY` | `config/.env.onprem.template:33`; `services/auth/src/index.ts:138` |
| `JWT_SECRET` | `config/.env.onprem.template:32`; `deploy/aws/.env.example:14`; `services/auth/src/turn.ts:28` |
| `KEYCLOAK_BOOTSTRAP_ADMIN_PASSWORD` | `deploy/keycloak/compose.yml:38` |
| `KEYCLOAK_BOOTSTRAP_ADMIN_USERNAME` | `deploy/keycloak/compose.yml:37` |
| `KEYCLOAK_DB_ADMIN_PASSWORD` | `deploy/keycloak/compose.yml:8` |
| `KEYCLOAK_DB_PASSWORD` | `deploy/keycloak/compose.yml:28`; `deploy/keycloak/compose.yml:9` |
| `KEYCLOAK_PORT` | `deploy/keycloak/compose.yml:40` |
| `KEYCLOAK_PUBLIC_URL` | `deploy/keycloak/compose.yml:29` |
| `LIBRETRANSLATE_API_KEY` | `deploy/aws/.env.example:69`; `deploy/aws/compose.yml:171`; `docker-compose.prod.yml:175`; +2 locations |
| `LIBRETRANSLATE_URL` | `config/.env.onprem.template:91`; `deploy/aws/.env.example:68`; `deploy/aws/compose.yml:170`; +2 locations |
| `LOG_LEVEL` | `services/auth/src/index.ts:39`; `services/meeting/src/index.ts:36`; `services/recording/src/index.ts:11`; +1 locations |
| `MCU_ENABLED` | `config/.env.onprem.template:82`; `services/signaling/src/config.ts:16` |
| `MCU_INTERNAL_URL` | `services/signaling/src/config.ts:17` |
| `MCU_PORT` | `services/mcu/src/index.ts:59` |
| `MEETING_DATABASE_URL` | `deploy/aws/.env.example:7`; `deploy/aws/compose.yml:147`; `services/meeting/src/index.ts:151` |
| `MEETING_DB_PASSWORD` | `config/.env.onprem.template:112`; `docker-compose.prod.yml:319` |
| `MEETING_DB_USER` | `config/.env.onprem.template:111`; `docker-compose.prod.yml:318` |
| `MEETING_INTERNAL_URL` | `docker-compose.prod.yml:183`; `services/meeting/src/signaling-bridge.ts:14`; `services/meeting/src/signaling-bridge.ts:15`; +8 locations |
| `MEETING_POLICY_SECRET` | `compose/core.yml:149`; `compose/core.yml:173`; `compose/single-box.yml:146`; +6 locations |
| `MEETING_PORT` | `deploy/aws/.env.example:41`; `services/meeting/src/index.ts:148`; `services/meeting/src/signaling-bridge.ts:15` |
| `MIGRATION_DATABASE_URL` | `deploy/aws/.env.example:11`; `deploy/aws/compose.yml:206` |
| `MINIO_ACCESS_KEY` | `compose/core.yml:63`; `compose/single-box.yml:64`; `config/.env.onprem.template:77`; +2 locations |
| `MINIO_BUCKET` | `config/.env.onprem.template:79` |
| `MINIO_ENDPOINT` | `config/.env.onprem.template:75` |
| `MINIO_PORT` | `compose/core.yml:68`; `compose/single-box.yml:69`; `config/.env.onprem.template:76` |
| `MINIO_SECRET_KEY` | `compose/core.yml:64`; `compose/single-box.yml:65`; `config/.env.onprem.template:78`; +2 locations |
| `MINUTES_LLM_API_KEY` | `config/.env.onprem.template:98`; `deploy/aws/.env.example:73`; `deploy/aws/compose.yml:178`; +2 locations |
| `MINUTES_LLM_MODEL` | `config/.env.onprem.template:97`; `deploy/aws/.env.example:72`; `deploy/aws/compose.yml:177`; +3 locations |
| `MINUTES_LLM_URL` | `config/.env.onprem.template:96`; `deploy/aws/.env.example:71`; `deploy/aws/compose.yml:176`; +3 locations |
| `MINUTES_TIMEOUT_MS` | `services/signaling/src/minutes.ts:47` |
| `MT_API_KEY` | `deploy/aws/cpu/.env.example:4`; `deploy/aws/cpu/compose.yml:56`; `deploy/aws/gpu/.env.example:5`; +4 locations |
| `MT_BASE_IMAGE` | `deploy/aws/gpu/compose.yml:46`; `docker-compose.prod.yml:404` |
| `MT_BEAMS` | `deploy/aws/cpu/compose.yml:58`; `deploy/aws/gpu/.env.example:12`; `deploy/aws/gpu/compose.yml:55`; +3 locations |
| `MT_CACHE_SIZE` | `services/mt/app.py:224` |
| `MT_DEVICE` | `services/mt/app.py:113` |
| `MT_DISABLE_AUTOLOAD` | `services/mt/app.py:262`; `services/mt/test_app.py:4` |
| `MT_GLOSSARY_FILE` | `services/mt/app.py:223`; `services/mt/test_app.py:27` |
| `MT_LANGUAGES` | `deploy/aws/cpu/.env.example:8`; `deploy/aws/cpu/compose.yml:55`; `deploy/aws/gpu/compose.yml:52`; +2 locations |
| `MT_MAX_PARALLEL` | `services/mt/app.py:226` |
| `MT_MODEL_EN_INDIC` | `deploy/aws/cpu/compose.yml:51`; `deploy/aws/gpu/compose.yml:50`; `docker-compose.prod.yml:409`; +1 locations |
| `MT_MODEL_INDIC_EN` | `deploy/aws/cpu/compose.yml:52`; `deploy/aws/gpu/compose.yml:51`; `docker-compose.prod.yml:410`; +1 locations |
| `MT_MODEL_INDIC_INDIC` | `services/mt/app.py:117` |
| `MT_PRELOAD` | `services/mt/app.py:127` |
| `MT_TORCH_INDEX` | `deploy/aws/gpu/compose.yml:47` |
| `MT_URL` | `services/signaling/src/captions.ts:88` |
| `NODE_ENV` | `config/.env.onprem.template:7`; `deploy/aws/.env.example:4`; `services/auth/src/billing.ts:132`; +24 locations |
| `ORIGIN_AUTH_SECRET` | `config/.env.onprem.template:105`; `deploy/aws/compose.yml:238` |
| `PAYMENTS_ENABLED` | `config/.env.onprem.template:37`; `deploy/aws/.env.example:15`; `deploy/aws/compose.yml:79`; +2 locations |
| `PAYMENT_RETURN_URL` | `config/.env.onprem.template:39`; `deploy/aws/.env.example:17`; `deploy/aws/compose.yml:81`; +2 locations |
| `PAYMENT_TERMS_CONFIRMED` | `config/.env.onprem.template:38`; `deploy/aws/.env.example:16`; `deploy/aws/compose.yml:80`; +2 locations |
| `PAYPAL_BASIC_ANNUAL_BASE_AMOUNT` | `deploy/aws/compose.yml:104`; `docker-compose.prod.yml:260` |
| `PAYPAL_BASIC_BASE_AMOUNT` | `deploy/aws/compose.yml:100`; `docker-compose.prod.yml:256` |
| `PAYPAL_BUSINESS_ANNUAL_BASE_AMOUNT` | `deploy/aws/compose.yml:122`; `docker-compose.prod.yml:278` |
| `PAYPAL_BUSINESS_BASE_AMOUNT` | `deploy/aws/compose.yml:118`; `docker-compose.prod.yml:274` |
| `PAYPAL_CLIENT_ID` | `config/.env.onprem.template:47`; `deploy/aws/.env.example:25`; `deploy/aws/compose.yml:89`; +3 locations |
| `PAYPAL_CLIENT_SECRET` | `config/.env.onprem.template:48`; `deploy/aws/.env.example:26`; `deploy/aws/compose.yml:90`; +3 locations |
| `PAYPAL_CURRENCY` | `config/.env.onprem.template:54`; `deploy/aws/.env.example:32`; `deploy/aws/compose.yml:94`; +4 locations |
| `PAYPAL_ENVIRONMENT` | `config/.env.onprem.template:46`; `deploy/aws/.env.example:24`; `deploy/aws/compose.yml:88`; +3 locations |
| `PAYPAL_PLAN_BASIC` | `deploy/aws/compose.yml:98`; `docker-compose.prod.yml:254` |
| `PAYPAL_PLAN_BASIC_ANNUAL` | `deploy/aws/compose.yml:102`; `docker-compose.prod.yml:258` |
| `PAYPAL_PLAN_BASIC_ANNUAL_TRIAL_14` | `deploy/aws/compose.yml:103`; `docker-compose.prod.yml:259` |
| `PAYPAL_PLAN_BASIC_TRIAL_14` | `deploy/aws/compose.yml:99`; `docker-compose.prod.yml:255` |
| `PAYPAL_PLAN_BUSINESS` | `deploy/aws/compose.yml:116`; `docker-compose.prod.yml:272` |
| `PAYPAL_PLAN_BUSINESS_ANNUAL` | `deploy/aws/compose.yml:120`; `docker-compose.prod.yml:276` |
| `PAYPAL_PLAN_BUSINESS_ANNUAL_TRIAL_14` | `deploy/aws/compose.yml:121`; `docker-compose.prod.yml:277` |
| `PAYPAL_PLAN_BUSINESS_TRIAL_14` | `deploy/aws/compose.yml:117`; `docker-compose.prod.yml:273` |
| `PAYPAL_PLAN_PRO` | `config/.env.onprem.template:51`; `deploy/aws/.env.example:29`; `deploy/aws/compose.yml:93`; +1 locations |
| `PAYPAL_PLAN_PRO_ANNUAL` | `deploy/aws/compose.yml:112`; `docker-compose.prod.yml:268` |
| `PAYPAL_PLAN_PRO_ANNUAL_TRIAL_14` | `deploy/aws/compose.yml:113`; `docker-compose.prod.yml:269` |
| `PAYPAL_PLAN_PRO_TRIAL` | `config/.env.onprem.template:53`; `deploy/aws/.env.example:31` |
| `PAYPAL_PLAN_PRO_TRIAL_14` | `deploy/aws/compose.yml:110`; `docker-compose.prod.yml:266` |
| `PAYPAL_PLAN_STARTER` | `config/.env.onprem.template:50`; `deploy/aws/.env.example:28`; `deploy/aws/compose.yml:92`; +1 locations |
| `PAYPAL_PLAN_STARTER_ANNUAL` | `deploy/aws/compose.yml:107`; `docker-compose.prod.yml:263` |
| `PAYPAL_PLAN_STARTER_ANNUAL_TRIAL_14` | `deploy/aws/compose.yml:108`; `docker-compose.prod.yml:264` |
| `PAYPAL_PLAN_STARTER_TRIAL` | `config/.env.onprem.template:52`; `deploy/aws/.env.example:30` |
| `PAYPAL_PLAN_STARTER_TRIAL_14` | `deploy/aws/compose.yml:105`; `docker-compose.prod.yml:261` |
| `PAYPAL_PRO_ANNUAL_BASE_AMOUNT` | `deploy/aws/compose.yml:114`; `docker-compose.prod.yml:270` |
| `PAYPAL_PRO_BASE_AMOUNT` | `config/.env.onprem.template:56`; `deploy/aws/.env.example:34`; `deploy/aws/compose.yml:96`; +1 locations |
| `PAYPAL_STARTER_ANNUAL_BASE_AMOUNT` | `deploy/aws/compose.yml:109`; `docker-compose.prod.yml:265` |
| `PAYPAL_STARTER_BASE_AMOUNT` | `config/.env.onprem.template:55`; `deploy/aws/.env.example:33`; `deploy/aws/compose.yml:95`; +1 locations |
| `PAYPAL_WEBHOOK_ID` | `config/.env.onprem.template:49`; `deploy/aws/.env.example:27`; `deploy/aws/compose.yml:91`; +4 locations |
| `POLY_BRIDGE_ENABLED` | `config/.env.onprem.template:83`; `services/signaling/src/rpc/handler.ts:1021`; `services/signaling/src/rpc/handler.ts:1041`; +4 locations |
| `POLY_BRIDGE_MODULE` | `services/sfu/src/index.ts:98` |
| `POLY_TENANT_ID` | `services/signaling/src/room-dial.ts:18` |
| `PORT` | `services/auth/src/index.ts:124`; `services/meeting/src/index.ts:148`; `services/meeting/src/signaling-bridge.ts:15`; +1 locations |
| `POSTGRES_DB` | `compose/core.yml:25`; `compose/core.yml:33`; `compose/single-box.yml:26`; +5 locations |
| `POSTGRES_HOST` | `config/.env.onprem.template:20` |
| `POSTGRES_PASSWORD` | `compose/core.yml:27`; `compose/single-box.yml:28`; `config/.env.onprem.template:24`; +1 locations |
| `POSTGRES_PORT` | `compose/core.yml:31`; `compose/single-box.yml:32`; `config/.env.onprem.template:21` |
| `POSTGRES_USER` | `compose/core.yml:26`; `compose/core.yml:33`; `compose/single-box.yml:27`; +4 locations |
| `QSVC_ADMIN_EMAILS` | `config/.env.onprem.template:17`; `services/auth/scripts/create-platform-admins.cjs:15` |
| `QSVC_ADMIN_PASSWORD` | `services/auth/scripts/create-platform-admins.cjs:12` |
| `QSVC_ADMIN_SIGNUP_OPEN` | `services/auth/src/index.ts:259` |
| `QSVC_ADMIN_WORKSPACE_URL` | `services/auth/src/enterprise-access.ts:181` |
| `QSVC_ALLOW_UNVERIFIED_MODELS` | `docker-compose.prod.yml:383`; `docker-compose.prod.yml:408`; `shared/model_security.py:12`; +1 locations |
| `QSVC_CONFIG_FILE` | `compose/ai.yml:16`; `compose/ai.yml:43`; `compose/ai.yml:69`; +15 locations |
| `QSVC_DEMO_DATABASE` | `deploy/aws/prepare-demo-db.cjs:5`; `services/auth/scripts/create-demo-accounts.cjs:10` |
| `QSVC_DEPLOYMENT` | `config/.env.onprem.template:8`; `services/auth/src/enterprise-access.ts:180`; `services/signaling/src/captions.ts:49`; +2 locations |
| `QSVC_DIGILOCKER_AUTHORIZE_URL` | `compose/core.yml:115`; `compose/single-box.yml:112`; `deploy/aws/compose.yml:63`; +1 locations |
| `QSVC_DIGILOCKER_CLIENT_ID` | `compose/core.yml:118`; `compose/single-box.yml:115`; `deploy/aws/compose.yml:66`; +1 locations |
| `QSVC_DIGILOCKER_CLIENT_SECRET` | `compose/core.yml:119`; `compose/single-box.yml:116`; `deploy/aws/compose.yml:67`; +1 locations |
| `QSVC_DIGILOCKER_ENABLED` | `compose/core.yml:114`; `compose/single-box.yml:111`; `deploy/aws/compose.yml:62`; +2 locations |
| `QSVC_DIGILOCKER_SCOPE` | `compose/core.yml:120`; `compose/single-box.yml:117`; `deploy/aws/compose.yml:68`; +2 locations |
| `QSVC_DIGILOCKER_TOKEN_URL` | `compose/core.yml:116`; `compose/single-box.yml:113`; `deploy/aws/compose.yml:64`; +1 locations |
| `QSVC_DIGILOCKER_USER_URL` | `compose/core.yml:117`; `compose/single-box.yml:114`; `deploy/aws/compose.yml:65`; +1 locations |
| `QSVC_E2EE_DEFAULT` | `services/signaling/src/rpc/handler.ts:1686` |
| `QSVC_EMAIL_API_KEY` | `compose/core.yml:125`; `compose/single-box.yml:122`; `deploy/aws/compose.yml:73`; +3 locations |
| `QSVC_EMAIL_FROM` | `compose/core.yml:126`; `compose/single-box.yml:123`; `deploy/aws/compose.yml:74`; +3 locations |
| `QSVC_ENTERPRISE_TERMS_REQUIRED` | `deploy/aws/compose.yml:161`; `deploy/aws/compose.yml:75`; `docker-compose.prod.yml:163`; +5 locations |
| `QSVC_GOOGLE_CLIENT_ID` | `compose/core.yml:121`; `compose/single-box.yml:118`; `deploy/aws/compose.yml:69`; +1 locations |
| `QSVC_GOOGLE_CLIENT_SECRET` | `compose/core.yml:122`; `compose/single-box.yml:119`; `deploy/aws/compose.yml:70`; +1 locations |
| `QSVC_KEYCLOAK_ADMIN_CLIENT_ID` | `compose/core.yml:111`; `compose/single-box.yml:108`; `deploy/aws/compose.yml:59`; +2 locations |
| `QSVC_KEYCLOAK_ADMIN_CLIENT_SECRET` | `compose/core.yml:112`; `compose/single-box.yml:109`; `deploy/aws/compose.yml:60`; +3 locations |
| `QSVC_KEYCLOAK_CLIENT_ID` | `services/auth/src/sso-keycloak.ts:28` |
| `QSVC_KEYCLOAK_CLIENT_SECRET` | `compose/core.yml:110`; `compose/single-box.yml:107`; `deploy/aws/compose.yml:58`; +3 locations |
| `QSVC_KEYCLOAK_INTERNAL_URL` | `compose/core.yml:109`; `compose/single-box.yml:106`; `deploy/aws/compose.yml:57`; +2 locations |
| `QSVC_KEYCLOAK_ISSUER` | `compose/core.yml:108`; `compose/single-box.yml:105`; `deploy/aws/compose.yml:56`; +2 locations |
| `QSVC_MICROSOFT_CLIENT_ID` | `compose/core.yml:123`; `compose/single-box.yml:120`; `deploy/aws/compose.yml:71`; +1 locations |
| `QSVC_MICROSOFT_CLIENT_SECRET` | `compose/core.yml:124`; `compose/single-box.yml:121`; `deploy/aws/compose.yml:72`; +1 locations |
| `QSVC_PUBLIC_URL` | `config/.env.onprem.template:11`; `services/auth/src/enterprise-access.ts:179` |
| `QSVC_SMOKE_TEST` | `frontend/desktop/src/main.ts:576` |
| `QSVC_SSO_AUTH_URL` | `compose/core.yml:106`; `compose/core.yml:16`; `compose/single-box.yml:103`; +6 locations |
| `QSVC_SSO_ENABLED` | `compose/core.yml:105`; `compose/single-box.yml:102`; `deploy/aws/compose.yml:53`; +2 locations |
| `QSVC_SSO_IDP_HOSTS` | `compose/core.yml:113`; `compose/single-box.yml:110`; `deploy/aws/compose.yml:61`; +2 locations |
| `QSVC_SSO_WEB_URL` | `compose/core.yml:107`; `compose/single-box.yml:104`; `deploy/aws/compose.yml:55`; +2 locations |
| `QSVC_TRIAL_NOW` | `services/auth/src/index.ts:390`; `services/auth/src/index.ts:391`; `services/auth/src/index.ts:470`; +1 locations |
| `QSVC_VERSION` | `compose/ai.yml:10`; `compose/ai.yml:37`; `compose/ai.yml:63`; +16 locations |
| `QSVC_WEB_URL` | `frontend/desktop/src/main.ts:64` |
| `RAZORPAY_KEY_ID` | `config/.env.onprem.template:41`; `deploy/aws/.env.example:19`; `deploy/aws/compose.yml:83`; +6 locations |
| `RAZORPAY_KEY_SECRET` | `config/.env.onprem.template:42`; `deploy/aws/.env.example:20`; `deploy/aws/compose.yml:84`; +5 locations |
| `RAZORPAY_PLAN_BASIC` | `deploy/aws/compose.yml:97`; `docker-compose.prod.yml:253` |
| `RAZORPAY_PLAN_BASIC_ANNUAL` | `deploy/aws/compose.yml:101`; `docker-compose.prod.yml:257` |
| `RAZORPAY_PLAN_BUSINESS` | `deploy/aws/compose.yml:115`; `docker-compose.prod.yml:271` |
| `RAZORPAY_PLAN_BUSINESS_ANNUAL` | `deploy/aws/compose.yml:119`; `docker-compose.prod.yml:275` |
| `RAZORPAY_PLAN_PRO` | `config/.env.onprem.template:45`; `deploy/aws/.env.example:23`; `deploy/aws/compose.yml:87`; +1 locations |
| `RAZORPAY_PLAN_PRO_ANNUAL` | `deploy/aws/compose.yml:111`; `docker-compose.prod.yml:267` |
| `RAZORPAY_PLAN_STARTER` | `config/.env.onprem.template:44`; `deploy/aws/.env.example:22`; `deploy/aws/compose.yml:86`; +1 locations |
| `RAZORPAY_PLAN_STARTER_ANNUAL` | `deploy/aws/compose.yml:106`; `docker-compose.prod.yml:262` |
| `RAZORPAY_WEBHOOK_SECRET` | `config/.env.onprem.template:43`; `deploy/aws/.env.example:21`; `deploy/aws/compose.yml:85`; +5 locations |
| `RECORDING_BUCKET` | `deploy/aws/.env.example:61`; `deploy/aws/compose.yml:195`; `services/recording/src/app.ts:58`; +1 locations |
| `RECORDING_PORT` | `services/recording/src/index.ts:17` |
| `REDIS_HOST` | `config/.env.onprem.template:27`; `services/sfu/src/config.ts:91`; `services/signaling/src/config.ts:23` |
| `REDIS_PASSWORD` | `compose/core.yml:44`; `compose/core.yml:50`; `compose/single-box.yml:45`; +7 locations |
| `REDIS_PORT` | `compose/core.yml:48`; `compose/single-box.yml:49`; `config/.env.onprem.template:28`; +2 locations |
| `REDIS_URL` | `services/signaling/src/config.ts:21` |
| `SESSION_SIGNING_KEY_FILE` | `compose/core.yml:273`; `compose/single-box.yml:329`; `config/.env.onprem.template:100`; +3 locations |
| `SFU_ANNOUNCED_IP` | `compose/core.yml:202`; `compose/core.yml:86`; `compose/mcu.yml:16`; +12 locations |
| `SFU_CONTROL_HOST` | `services/sfu/src/index.ts:347` |
| `SFU_CONTROL_TOKEN` | `config/.env.onprem.template:68`; `deploy/aws/.env.example:12`; `deploy/aws/.env.example:52`; +6 locations |
| `SFU_INTERNAL_URL` | `deploy/aws/.env.example:45`; `services/signaling/src/config.ts:8` |
| `SFU_LOG_LEVEL` | `services/sfu/src/config.ts:10`; `services/sfu/src/config.ts:14`; `services/sfu/src/logger.ts:8` |
| `SFU_MAX_PORT` | `config/.env.onprem.template:67`; `deploy/aws/.env.example:49`; `services/sfu/src/config.ts:29` |
| `SFU_MIN_PORT` | `config/.env.onprem.template:66`; `deploy/aws/.env.example:48`; `services/sfu/src/config.ts:28` |
| `SFU_NUM_WORKERS` | `deploy/aws/.env.example:47`; `services/sfu/src/config.ts:9` |
| `SFU_PORT` | `compose/mcu.yml:15`; `config/.env.onprem.template:64`; `deploy/aws/.env.example:43`; +1 locations |
| `SIGNALING_DIST` | `services/meeting/src/signaling-bridge.ts:10`; `services/meeting/src/signaling-bridge.ts:14`; `services/meeting/src/signaling-bridge.ts:25` |
| `SIGNALING_MAX_ROOMS` | `services/signaling/src/room-manager.ts:153` |
| `SIGNALING_PORT` | `deploy/aws/.env.example:42`; `services/signaling/src/config.ts:7` |
| `SIGNALING_URL` | `compose/mcu.yml:28`; `services/sfu/src/poly-adapter.ts:50` |
| `STUN_SERVERS` | `services/auth/src/turn.ts:32`; `services/signaling/src/config.ts:11` |
| `TRANSLATION_TIMEOUT_MS` | `services/signaling/src/captions.ts:99` |
| `TURN_ACCESS_SECRET` | `compose/core.yml:103`; `compose/core.yml:175`; `compose/single-box.yml:100`; +6 locations |
| `TURN_ALLOWED_SFU_IP` | `compose/core.yml:87`; `compose/single-box.yml:83`; `deploy/aws/compose.yml:219`; +1 locations |
| `TURN_CERT_FILE` | `deploy/turn/compose.aws-tls.yml:10`; `deploy/turn/compose.tls.yml:9` |
| `TURN_HOST` | `deploy/turn/compose.aws-tls.yml:4`; `deploy/turn/compose.aws-tls.yml:5`; `deploy/turn/compose.tls.yml:5`; +1 locations |
| `TURN_KEY_FILE` | `deploy/turn/compose.aws-tls.yml:11`; `deploy/turn/compose.tls.yml:10` |
| `TURN_PASSWORD` | `services/signaling/src/config.ts:12`; `services/signaling/src/config.ts:13` |
| `TURN_REALM` | `compose/core.yml:85`; `compose/single-box.yml:81`; `docker-compose.prod.yml:107` |
| `TURN_SECRET` | `compose/core.yml:84`; `compose/single-box.yml:80`; `config/.env.onprem.template:106`; +8 locations |
| `TURN_SERVERS` | `config/.env.onprem.template:72`; `deploy/aws/.env.example:55`; `deploy/aws/compose.yml:25`; +3 locations |
| `TURN_USERNAME` | `services/signaling/src/config.ts:12`; `services/signaling/src/config.ts:13` |
| `VITE_API_URL` | `frontend/web/src/components/CancelScheduledMeeting.tsx:5`; `frontend/web/src/components/HostedMeetings.tsx:7`; `frontend/web/src/components/InviteModal.tsx:6`; +7 locations |
| `VITE_AUTH_URL` | `frontend/web/src/components/InviteModal.tsx:5`; `frontend/web/src/lib/session.ts:1`; `frontend/web/src/pages/AdminDashboard.tsx:79`; +2 locations |
| `VITE_MEETING_URL` | `frontend/web/src/components/CancelScheduledMeeting.tsx:5`; `frontend/web/src/components/HostedMeetings.tsx:7`; `frontend/web/src/components/InviteModal.tsx:6`; +8 locations |
| `VITE_RECORDING_URL` | `frontend/web/src/lib/recording.ts:4`; `frontend/web/src/pages/AdminDashboard.tsx:81` |
| `VITE_SIGNALING_URL` | `frontend/web/src/lib/signaling.ts:6`; `frontend/web/src/pages/AdminDashboard.tsx:78`; `frontend/web/src/pages/Landing.tsx:17` |
| `WEB_URL` | `config/.env.onprem.template:12`; `deploy/aws/.env.example:2`; `deploy/aws/compose.yml:14`; +7 locations |
| `WS_MAX_CONNECTIONS` | `services/signaling/src/ws-attach.ts:81` |
| `WS_MAX_CONNECTIONS_PER_IP` | `services/signaling/src/ws-attach.ts:79` |
| `WS_MAX_JOINS_PER_IP` | `services/signaling/src/ws-attach.ts:82` |
| `WS_MAX_TRACKED_IPS` | `services/signaling/src/ws-attach.ts:83` |
| `WS_MAX_UPGRADES_PER_IP` | `services/signaling/src/ws-attach.ts:80` |
| `WS_TICKET_STORE` | `deploy/aws/compose.yml:166`; `services/signaling/src/ws-tickets.ts:12` |
| `WS_TRUST_PROXY_HEADER` | `services/signaling/src/ws-attach.ts:16` |

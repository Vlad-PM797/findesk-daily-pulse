# Findesk — дерево продукту й технічної платформи

Зріз станом на 05.08.2026. Основою є актуальний приватний монорепозиторій `EON-plus-dev/Findesk-prod`, гілка `main`, commit `bf591da24c7a4de6f59a555644aa0678153c771e`.

## Як читати дерево

- Канали та інтерфейси: основний кабінет `frontend-nextjs`, адмінпанель `admin`, публічний ресурсний центр `lending` + `lending-api`, realtime-канал `websocket-server`.
- Ядро керування: `auth`, `office-user`, `main-orchestrator`, внутрішній gateway та міжсервісні API/MCP-контракти.
- Документи й кадри: `agreements`, `document-flow`, `documents-reports`, `staff_doc`.
- Облік і податки: `income_accounting_book_report`, `calculation_ep`, `fop-limits-monitoring`, `dps`, `tax_reporting_service`, `findesk-calendar`.
- AI і комунікації: `ai_chat`, `main-orchestrator`, `notifications`, `statistics_email`.
- Комерція й окремі контури: `credit_system`, `way4pay`, `tov-core`, ізольований повний стек `deploy/tov-initask`.
- Спільна платформа: PostgreSQL, Redis, Kafka, TaskIQ, файлове сховище та бібліотеки `shared/`.
- Доставка й керування: GitHub Actions, Docker/Dokploy, GlitchTip/журнали, Worksection 311247 та окремий QA-простір 303222.

## Ключові потоки

1. Чат: клієнт → `websocket-server` → Kafka → `main-orchestrator` → MCP-сервіс → Kafka → клієнт.
2. Документи: завантаження → AI-аналіз → шаблон/поля → TaskIQ → перевірка → підпис → зберігання/відправлення.
3. Облік: банки й платіжні системи → книга доходів → розрахунки → ліміти → календар і звітність.
4. Оплата: `credit_system` → `way4pay` → WayForPay → Kafka → оновлення балансу та сповіщення.
5. Ідентифікація: Google OAuth або Дія → `auth` → JWT/міжсервісний токен → доступ до сервісів.

## Перевірені джерела

- `README.md:1-138` — позиціонування, основні можливості, базова мікросервісна модель та інфраструктура.
- `architecture/FINDESK_ARCHITECTURE_DOCUMENT.md:1-29,247-396` — доменне групування, центральна роль `office-user`, дашборди та функціональні розділи. Файл збережений у UTF-16LE; читався без зміни через `iconv`.
- `.github/workflows/ci-tests.yml:63-79,134-142` — актуальна CI-матриця сервісів, дозволені міжсервісні імена та AI-залежності тестового середовища.
- `deploy/tov-initask/docker-compose.yml:24-1127` і `deploy/tov-initask/README.md:1-38` — найповніший наявний склад: 5 інфраструктурних контейнерів, 21 бекенд, 6 worker/scheduler-процесів, 3 фронти та схема чат/MCP-трафіку. Числа пораховані з поточного compose; текст README ще вказує старіший склад.
- `main-orchestrator/ORCHESTRATOR_FLOW.md:17-30` і `websocket-server/README.md:1-63` — realtime-потік через WebSocket, Kafka, LLM-агентів та MCP.
- `documents-reports/README.md:1-49` — AI-аналіз, Вчасно, МЕДОК, Дія.Підпис і Gemini.
- `credit_system/README.md:181-211,399-428` і `way4pay/README.md:1-18` — розподіл відповідальності за тарифи/кредити та приймання платежів, Kafka-потік.
- Worksection: проєкт 311247 `FinDesk (всі мікросервіси)`, 5049 задач у вибірці, 93 активні; окремий проєкт тестування — 303222.
- Graphify: репозиторій видимий, 61 408 вузлів і 116 452 зв'язки; статус синхронізації `pending`, тому Graphify використовувався як допоміжна карта, не як джерело назв вузлів.

## Обмеження

Це перевірене дерево продукту, коду й керованого повного сервісного контуру. Воно не стверджує, що всі показані сервіси та інтеграції одночасно запущені в production: фактичний список активних контейнерів і runtime-стан у межах цього запиту не перевірявся.

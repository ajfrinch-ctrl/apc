# Telegram admin notifications

This feature sends selected Active Plus events to one Telegram chat using Firebase Cloud Functions. It keeps the bot token out of browser code and the GitHub Pages bundle.

## Events

- New legacy Realtime Database registration notification (`activePlusSync/v1/notifications/{id}`).
- New staged Firestore exam attempt (`attempts/{attemptId}`).
- Exam results becoming released (`exams/{examId}` changes `resultsReleased` from false/unset to true).
- New encrypted class-chat relay record (`activePlusSync/v1/classChat/{recordId}`).

**Class chat privacy:** APC encrypts message content in the browser before writing it to Firebase. The Telegram alert therefore includes class/room, sender ID and message ID only—not the message text. Do not weaken the encryption or upload room keys to make message text available to Telegram.

## One-time operator setup

1. Create a bot with Telegram's official **@BotFather** and copy its token.
2. Open the bot in Telegram and press **Start**. To notify a group, add the bot to that group and send a message there.
3. Obtain the destination chat ID using a trusted Telegram bot update viewer or the Bot API `getUpdates` endpoint. Keep both the token and chat ID private.
4. In the APC repository's Firebase project, set the secrets from a trusted terminal:
   ```sh
   firebase functions:secrets:set TELEGRAM_BOT_TOKEN
   firebase functions:secrets:set TELEGRAM_CHAT_ID
   ```
   Enter values at the prompts; do not put them in source files, command-line arguments, screenshots, or chat messages.
5. Deploy the functions:
   ```sh
   cd functions
   npm ci
   cd ..
   firebase deploy --only functions
   ```
6. Check the Cloud Functions logs and send test events for registration, exam submission, result release and a class chat message. The project may require the Firebase/Google Cloud billing plan needed for outbound Cloud Functions and external network requests.

## Operational notes

- This feature only notifies for new events after deployment; it does not backfill historical records.
- Telegram delivery uses a Firestore ledger for retries/deduplication. Telegram does not provide an idempotency key, so a rare duplicate is possible if a function stops immediately after Telegram accepts a message.
- Existing in-app notifications and web push are unchanged.
- Do not share the bot token. If it is exposed, revoke it with BotFather and rotate the Firebase secret.
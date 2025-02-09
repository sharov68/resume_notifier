import 'dart:async';
import 'dart:io';
import 'package:telegram_client/telegram_client.dart';

const String botToken = 'YOUR_BOT_TOKEN_HERE';

final TelegramClient tgClient = TelegramClient(botToken);
final Set<int> subscribers = {}; // Храним ID подписчиков
bool wasOffline = true; // Флаг для отслеживания статуса интернета

Future<bool> checkInternet() async {
  try {
    final result = await InternetAddress.lookup('google.com');
    return result.isNotEmpty && result[0].rawAddress.isNotEmpty;
  } catch (_) {
    return false;
  }
}

void startCheckingInternet() {
  Timer.periodic(Duration(minutes: 1), (timer) async {
    bool isOnline = await checkInternet();
    if (wasOffline && isOnline) {
      wasOffline = false;
      for (var chatId in subscribers) {
        tgClient.api.request('sendMessage', {
          'chat_id': chatId,
          'text': '✅ Электроснабжение и интернет восстановлены!'
        });
      }
    } else if (!isOnline) {
      wasOffline = true;
    }
  });
}

void main() async {
  print('Бот запущен...');

  tgClient.onUpdate((update) {
    if (update["message"]?["text"] == "/start") {
      int chatId = update["message"]["chat"]["id"];
      subscribers.add(chatId);
      tgClient.api.request('sendMessage', {
        'chat_id': chatId,
        'text': 'Вы подписались на уведомления о восстановлении работы.'
      });
    }
  });

  startCheckingInternet();
}

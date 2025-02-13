const config = require('./config');
let localConfig = {};
try {
	localConfig = require('./local-config');
} catch (error) { /**/ }
const _ = require('lodash');
const cfg = _.merge(config, localConfig);
const internetMonitoringInterval = cfg.internetMonitoringInterval * 1000;
//const dns = require('dns');
const { exec } = require('child_process');
const { MongoClient } = require('mongodb');
const MONGO_URI = `mongodb://${cfg.mongodb.host}:${cfg.mongodb.port}/${cfg.mongodb.db}`;
console.log(MONGO_URI);
const client = new MongoClient(MONGO_URI);
const TelegramBot = require('node-telegram-bot-api');
const { log } = require('console');
const token = cfg.apiKey;
const bot = new TelegramBot(token, { polling:true });
let db, online_history, subscribers, messages;
const reasons = {
	"no internet": 1,
	"stopped service": 1
};
const initAnswer = `/help - список команд.`;
const helpAnswer = `
/message <ваше сообщение> - отправить сообщение разработчику. Сообщения без /message, а также вложения игнорируются ботом;
/lastOffline1 - узнать время последнего отключения интернета;
/lastOffline2 - узнать время последнего отключения сервиса;
`;

(async () => {
	await initMongoDB();
	await checkLastOnlineStatus();
	await monitorInternet();
})();

async function initMongoDB() {
	try {
		await client.connect();
		db = client.db(cfg.mongodb.db);
		online_history = db.collection("online_history");
		subscribers = db.collection("subscribers");
		messages = db.collection("messages");
		console.log('Подключение к MongoDB успешно');
		bot.setMyCommands([
			{ command: '/help', description: 'Список команд' }
		]);
		bot.onText(/\/message/, async msg => {
			const chatId = msg.chat.id;
			if (chatId == cfg.adminChatId) {
				const count = await messages.count();
				await bot.sendMessage(chatId, `Привет, Босс!. На данный момент в БД ${count} сообщений.`);
			} else {
				await bot.sendMessage(chatId, "Хорошо, я передам данное сообщение разработчику, он ответит как можно быстрее.");
				await bot.sendMessage(cfg.adminChatId, `Новое сообщение от пользователя ${msg.from.first_name} ${msg.from.last_name} (@${msg.from.username}): "${msg.text}"`);
			}
			await saveToDB(msg);
		});
		bot.onText(/\/lastOffline1/, async msg => {
			const chatId = msg.chat.id;
			const lastNegativeEvent = await getLastEvent("no internet");
			await bot.sendMessage(chatId, lastNegativeEvent);
			await saveToDB(msg);
		});
		bot.onText(/\/lastOffline2/, async msg => {
			const chatId = msg.chat.id;
			const lastNegativeEvent = await getLastEvent("stopped service");
			await bot.sendMessage(chatId, lastNegativeEvent);
			await saveToDB(msg);
		});
		bot.onText(/\/help/, async msg => {
			const chatId = msg.chat.id;
			await bot.sendMessage(chatId, helpAnswer);
			await saveToDB(msg);
		});
		bot.onText(/\/start/, async msg => {
			const chatId = msg.chat.id;
			console.log(improveDate(new Date()), "chat id:", chatId);
			await bot.sendMessage(chatId, initAnswer);
			await saveToDB(msg);
		});
	} catch (err) {
		console.error('Ошибка подключения к MongoDB:', err);
		process.exit(1);
	}
}

async function getLastEvent(reason) {
	if (!reasons[reason]) {
		return "Негативных событий небыло!";
	}
	const lastEvent = await online_history.findOne({ reason }, { sort:{ _id:-1 } });
	if (!lastEvent) {
		return "Негативных событий небыло!";
	}
	return `Последнее событие ${reason} было ${improveDate(lastEvent._dt)}.`;
}

async function saveToDB(msg) {
	msg._dt = new Date();
	await messages.insertOne(msg);
	const subscriber = await subscribers.findOne({ id:msg.from.id });
	if (subscriber) {
		const { _id } = subscriber;
		const $set = _.merge(subscriber, msg.from);
		delete $set._id;
		delete $set._b_inactive;
		const $unset = { _b_inactive:"" };
		await subscribers.updateOne({ _id }, { $set, $unset });
	} else {
		await subscribers.insertOne(msg.from);
	}
}

async function checkLastOnlineStatus() {
	const lastEvent = await online_history.findOne({}, { sort:{ _id:-1 } });
	if (lastEvent) {
		const currentDate = (new Date()).valueOf();
		if (currentDate - (lastEvent._dt).valueOf() > internetMonitoringInterval*2) {
			const data = {
				status: "offline",
				_dt: new Date(),
				reason: "stopped service"
			};
			await online_history.insertOne(data);
			const msg = `Сервис возобновил работу. Последнее зарегистрированное событие ${lastEvent.status} ${improveDate(lastEvent._dt)}`;
			await notificationDistribution(msg);
		}
	}
}

async function notificationDistribution(msg) {
	console.log(improveDate(new Date()), msg);
	const subscribersList = await subscribers.find({ _b_inactive:{ $ne:1 } }).toArray();
	for (let i = 0; i < subscribersList.length; i++) {
		const subscriber = subscribersList[i];
		try {
			const outgoingMessage = await bot.sendMessage(subscriber.id, msg); // возвращает телеграмовский объект исходящего сообщения. Если что, тоже можно будет сохранять.
		} catch (error) {
			await subscribers.updateOne({ _id:subscriber._id }, { $set:{ _b_inactive:1 } });
		}
	}
}

async function checkInternet() {
	return new Promise(resolve => {
		exec('ping -c 1 pepelac1.ddns.net', (error, stdout, stderr) => {
			if (error || stderr) {
				console.log(`${improveDate(new Date())} - Интернета нет`);
				resolve(0);
			} else {
				console.log(`${improveDate(new Date())} - Интернет есть`);
				resolve(1);
			}
		});
	});
	/*return new Promise((resolve) => {
		dns.lookup('t.me', (err) => {
			resolve(!err);
		});
	});*/
}

async function monitorInternet() {
	while (true) {
		const isConnected = await checkInternet();
		const lastEvent = await online_history.findOne({}, { sort:{ _id:-1 } }) || {};
		if (isConnected) {
			if (lastEvent.status == "online") {
				const $set = {
					_dt: new Date()
				};
				await online_history.updateOne({ _id:lastEvent._id }, { $set });
			} else {
				const data = {
					status: "online",
					_dt: new Date()
				};
				await online_history.insertOne(data);
				if (lastEvent.reason == "no internet") {
					const msg = `Интернет восстановлен. Последнее зарегистрированное событие ${lastEvent.status} ${improveDate(lastEvent._dt)}`;
					await notificationDistribution(msg);
				}
			}
		} else {
			if (lastEvent.status == "offline") {
				const $set = {
					_dt: new Date()
				};
				await online_history.updateOne({ _id:lastEvent._id }, { $set });
			} else {
				const data = {
					status: "offline",
					_dt: new Date(),
					reason: "no internet"
				};
				await online_history.insertOne(data);
			}
		}
		await new Promise(resolve => setTimeout(resolve, internetMonitoringInterval));
	}
}

function improveDate(date) {
	const str = date.toString();
	const arr = _.split(str, " GMT");
	return arr[0];
}

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

let db, online_history;

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
		console.log('Подключение к MongoDB успешно');
	} catch (err) {
		console.error('Ошибка подключения к MongoDB:', err);
		process.exit(1);
	}
}

async function checkLastOnlineStatus() {
	const lastEvent = await online_history.findOne({}, { sort:{ _id:-1 } });
	if (lastEvent) {
		const currentDate = (new Date()).valueOf();
		if (currentDate - (lastEvent._dt).valueOf() > internetMonitoringInterval) {
			console.log("Сервис перезапущен. Время предыдущего события:", improveDate(lastEvent._dt));
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

require('dotenv').config();
const moment = require('moment');
const line = require('@line/bot-sdk');
const express = require('express');
const agenda = require('agenda');
const chrono = require('chrono-node');

const config = {
  channelAccessToken: process.env.CHANNEL_ACCESS_TOKEN,
  channelSecret: process.env.CHANNEL_SECRET,
};

const client = new line.Client(config);

const reminder = new agenda({db: { address: process.env.MONGODB_URI, collection: 'reminder' }});
reminder.define('push message', (job, done) => {
  const data = job.attrs.data;
  const message = { type: 'text', text: data.message };
  client.pushMessage(data.to, message);
  done();
});
reminder.on('ready', () => {
  reminder.start();
});

const handleMessages = async (event) => {
  const now = moment();
  const command = event.message.text.match(/^\/([a-z]+)/);
  if (command == null) {
    return Promise.resolve(null);
  }

  const [userId, displayName] = await (async (event) => {
    const dummyProfile = { userId: event.source.userId, displayName: 'unknown' };
    switch (event.source.type) {
      case 'user': {
        const profile = await client.getProfile(event.source.userId).catch(() => dummyProfile);
        return [profile.userId, profile.displayName];
      }
      case 'group': {
        const profile = await client.getGroupMemberProfile(event.source.groupId, event.source.userId).catch(() => dummyProfile);
        return [profile.userId, profile.displayName];
      }
      case 'room': {
        const profile = await client.getRoomMemberProfile(event.source.roomId, event.source.userId).catch(() => dummyProfile);
        return [profile.userId, profile.displayName];
      }
      default: {
       return ['', ''];
      }
    }
  })(event).catch(() => ['error', 'error']);
  console.log(`received /${command[1]} from ${displayName}[${userId}].`);
    
  switch (command[1]) {
    case 'echo': {
      const input = event.message.text.match(/^.*(?:\r\n|\r|\n)([\s\S]*)$/);
      if (input == null) {
        const err = {type: 'text', text: `${command[1]} syntax error`};
        return client.replyMessage(event.replyToken, err);
      }
      const echo = { type: 'text', text: input[1] };
      return client.replyMessage(event.replyToken, echo);
    }
    case 'remind': {
      const input = event.message.text.match(/^.*(?:\r\n|\r|\n)([\s\S]*)(?:\r\n|\r|\n)(.*)$/);
      if (input == null) {
        const err = { type: 'text', text: `${command[1]} syntax error` };
        return client.replyMessage(event.replyToken, err);
      }
      let time = chrono.parseDate(input[2]);
      if (time == null) {
        const err = { type: 'text', text: `${command[1]} parse error` };
        return client.replyMessage(event.replyToken, err);
      }
      if (moment(time).isBefore(now) && !/[0-9]{4}/.test(input[2])) {
        if (moment(time).isSame(now, 'day')) {
          time = moment(time).add(1, 'day').toDate();
        } else {
          time = moment(time).add(1, 'year').toDate();
        }
      }
      reminder.schedule(time, 'push message', { to: userId, message: input[1] });
      const reply = { type: 'text', text: `I'll remind you ${moment(time).format('YYYY-MM-DD HH:mm:ss Z')}.` };
      return client.replyMessage(event.replyToken, reply);
    }
    default: {
      return Promise.resolve(null);
    }
  }
}

const handleEvent = async (event) => {
  switch (event.type) {
    case 'message': {
      switch (event.message.type) {
        case 'text': {
          return handleMessages(event);
        }
        default: {
          return Promise.resolve(null);
        }
      }
    }
    default: {
      return Promise.resolve(null);
    }
  }
}

const app = express();

app.get('/line', (req, res) => {
  res.send('Hello, world.')
})

app.post('/line/webhook', line.middleware(config), (req, res) => {
  Promise
    .all(req.body.events.map(handleEvent))
    .then((result) => res.json(result));
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log('Hello, LINE bot.');
});

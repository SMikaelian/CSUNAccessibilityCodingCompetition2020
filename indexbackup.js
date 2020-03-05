require('dotenv').config()
const Discord = require('discord.js')
const config = require('./config')

const discordClient = new Discord.Client()

const { Readable } = require('stream');

const SILENCE_FRAME = Buffer.from([0xF8, 0xFF, 0xFE]);

class Silence extends Readable {
  _read() {
    this.push(SILENCE_FRAME);
  }
}

const { Transform } = require('stream')

function convertBufferTo1Channel(buffer) {
  const convertedBuffer = Buffer.alloc(buffer.length / 2)

  for (let i = 0; i < convertedBuffer.length / 2; i++) {
    const uint16 = buffer.readUInt16LE(i * 4)
    convertedBuffer.writeUInt16LE(uint16, i * 2)
  }

  return convertedBuffer
}

class ConvertTo1ChannelStream extends Transform {
  constructor(source, options) {
    super(options)
  }

  _transform(data, encoding, next) {
    next(null, convertBufferTo1Channel(data))
  }
}

const googleSpeech = require('@google-cloud/speech')

const googleSpeechClient = new googleSpeech.SpeechClient()

discordClient.on('presenceUpdate', async (oldPresence, newPresence) => {
  console.log('New Presence:', newPresence)

  const member = newPresence.member
  const presence = newPresence
  const memberVoiceChannel = member.voice.channel

  if (!presence || !presence.activity || !presence.activity.name || !memberVoiceChannel) {
    return
  }

  const connection = await memberVoiceChannel.join()
  const receiver = connection.receiver
  connection.play(new Silence(), { type: 'opus' });
  connection.on('speaking', (user, speaking) => {
    if (!speaking) {
      return
    }

    console.log(`I'm listening to ${user.username}`)

    // this creates a 16-bit signed PCM, stereo 48KHz stream
    const audioStream = receiver.createStream(user, { mode: 'pcm' })
    const requestConfig = {
      encoding: 'LINEAR16',
      sampleRateHertz: 48000,
      languageCode: 'en-US'
    }
    const request = {
      config: requestConfig
    }
    const recognizeStream = googleSpeechClient
      .streamingRecognize(request)
      .on('error', console.error)
      .on('data', response => {
        const transcription = response.results
          .map(result => result.alternatives[0].transcript)
          .join('\n')
          .toLowerCase()
        console.log(`Transcription: ${transcription}`)
      })

    const convertTo1ChannelStream = new ConvertTo1ChannelStream()

    audioStream.pipe(convertTo1ChannelStream).pipe(recognizeStream)

    audioStream.on('end', async () => {
      console.log('audioStream end')
    })
  })
})

discordClient.on('ready', () => {
  console.log(`Logged in as ${discordClient.user.tag}!`)
})


discordClient.login(config.discordApiToken)
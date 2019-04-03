require('dotenv').config()
const axios = require('axios')
const Fuse = require('fuse.js')
const cacheAdapterEnhancer = require('axios-extensions').cacheAdapterEnhancer
const Discord = require('discord.js')
const Embed = Discord.RichEmbed

const bot = new Discord.Client()

const http = axios.create({
  baseUrl: '',
  headers: { 'Cache-Control': 'no-cache' },
  adapter: cacheAdapterEnhancer(axios.defaults.adapter)
})

const fuseOptions = {
  shouldSort: true,
  includeScore: true,
  threshold: 0.3,
  location: 0,
  distance: 100,
  maxPatternLength: 32,
  minMatchCharLength: 1
}

const islandCmd = new Set()
const creatorCmd = new Set()

async function asyncForEach(array, callback) {
  for (let i = 0; i < array.length; i++)
    await callback(array[i], i, array)
}

// initial request
http.get(`${process.env.API_URL}/api/islands.json`).then(() => {
  console.log('GET islands.json')
})

http.get(`${process.env.API_URL}/api/creators.json`).then(() => {
  console.log('GET creators.json')
})

bot.on('ready', () => {
  const msg = `Logged in as: ${bot.user.username}`
  console.log(`${msg}\nID: ${bot.user.id}`)
  console.log('-'.repeat(msg.length))
  bot.user.setPresence({ game: { name: 'the map! | ?island', type: 'WATCHING' }, status: 'online' })

  bot.prefix = '?'

  setInterval(() => {
    bot.user.setPresence({ game: { name: 'the map! | ?island', type: 'WATCHING' }, status: 'online' })
  }, 86400000)
})

bot.on('error', err => {
  console.error(err.message)
})

bot.on('disconnect', () => console.log('Disconnected!'))

bot.on('reconnecting', () => {
  console.log('Reconnecting...')
  bot.user.setPresence({ game: { name: 'the map! | ?island', type: 'WATCHING' }, status: 'online' })
})

bot.on('message', async msg => {
  if (msg.author.bot) return;
  if (!msg.content.startsWith(bot.prefix)) return;
  const args = msg.content.slice(bot.prefix.length).trim().split(/\s+/g)
  const cmd = args.shift().toLowerCase()
  switch (cmd) {
    case 'creator': {
      if (creatorCmd.has(msg.author.id)) {
        if (!msg.author.dmChannel) await msg.author.createDM()
        msg.author.dmChannel.send('You must wait to use that command!')
        return msg.channel.type === 'dm' ? null : msg.delete()
      }
      if (args.length < 1) {
        if (!msg.author.dmChannel) await msg.author.createDM()
        const embed = new Embed()
        embed.setTitle(`${bot.prefix}creator command`)
          .setColor('#8c0000')
          .addField('Usage', `${bot.prefix}creator <name|id>`)
          .addField('Description', 'Shows islands created by the specific creator')
        return msg.author.dmChannel.send(embed)
      }
      const request = await http.get(`${process.env.API_URL}/api/creators.json`)
      const creatorData = request.data
      let creator = null
      const creatorID = args.join(' ')
      if (isNaN(parseInt(creatorID)))
        creator = creatorData.find(c => c.name === creatorID)
      else
        creator = creatorData.find(c => c.id === parseInt(creatorID))

      let time = null
      if (!creator) {
        fuseOptions.keys = [
          { name: 'name' }
        ]
        const fuse = new Fuse(creatorData, fuseOptions)
        const results = fuse.search(args.join(' '))

        if (results.length === 0) {
          return msg.reply('No islands found with that author name!')
        }
        else if (results.length > 4) {
          if (!msg.author.dmChannel) await msg.author.createDM()
          msg.author.dmChannel.send('Too many search results! Please narrow it')
          return msg.channel.type === 'dm' ? null : msg.delete()
        }
        else if (results.length !== 1) {
          time = await msg.react('\u23F3')
          const searchEmbed = new Embed().setTitle('Did you mean...')
          let description = 'React with or type the letter of the creator!\n\n'
          let letters = []
          let emojis = []
          results.forEach((r, i) => {
            description += `:regional_indicator_${String.fromCharCode(97+i)}: ${r.item.name}\n`
            emojis.push(`${String.fromCharCode(55356)}${String.fromCharCode(56806 + i)}`)
            letters.push(String.fromCharCode(97+i))
          })
          searchEmbed.setDescription(description)
          if (!msg.author.dmChannel) await msg.author.createDM()
          const m = await msg.author.dmChannel.send(searchEmbed)
          const reactFilter = (reaction, user) => user.id === msg.author.id && emojis.includes(reaction.emoji.name)
          const msgFilter = am => am.author.id === msg.author.id
          let choice = null
          asyncForEach(emojis, async e => {
            if (!choice)
              await m.react(e)
          })
          let aReacts = m.awaitReactions(reactFilter, { max: 1, time: 30000 })
          let aMsgs = m.channel.awaitMessages(msgFilter, { max: 1, time: 30000})
          choice = await Promise.race([aReacts, aMsgs])
          if (choice.size === 0) {
            m.delete()
            if (!msg.author.dmChannel) await msg.author.createDM()
            msg.author.dmChannel.send('You did not make a selection!')
            return msg.channel.type === 'dm' ? null : msg.delete()
          }
          else {
            if (choice.first().content)
              creator = results[letters.indexOf(choice.first().content.toLowerCase())].item
            else
              creator = results[emojis.indexOf(choice.first().emoji.name)].item
          }
        }
        else creator = results[0].item
      }
      const islandRequest = await http.get(`${process.env.API_URL}/api/islands.json`)
      const creatorIslands = islandRequest.data.features.filter(i => i.properties.creator === creator.name)
      let description = `Islands created by ${creator.name}\n\n`
      creatorIslands.forEach(is => {
        const name = is.properties.nickName || is.properties.name
        description += `**${name}**: [PvE](https://map.cardinalguild.com/pve/?island=${is.id})/[PvP](https://map.cardinalguild.com/pvp/?island=${is.id})\n`
      })

      const creatorEmbed = new Embed()
        .setThumbnail('https://map.cardinalguild.com/_nuxt/img/cd4d6e4.png')
        .setAuthor(creator.name, null, creator.workshopUrl)
        .setDescription(description)
        .setFooter(`Count: ${creatorIslands.length}`)
        .setColor('#8c0000')
      if (time) time.remove()
      msg.react('\u2705')
      msg.channel.send(creatorEmbed)
      creatorCmd.add(msg.author.id)
      setTimeout(() => {
        creatorCmd.delete(msg.author.id)
      }, 10000)
      break
    }
    case 'island': {
      if (islandCmd.has(msg.author.id)) {
        if (!msg.author.dmChannel) await msg.author.createDM()
        msg.author.dmChannel.send('You must wait to use that command!')
        return msg.channel.type === 'dm' ? null : msg.delete()
      }
      if (args.length < 1) {
        if (!msg.author.dmChannel) await msg.author.createDM()
        const embed = new Embed()
        embed.setTitle(`${bot.prefix}island command`)
          .setColor('#8c0000')
          .addField('Usage', `${bot.prefix}island <name|id>`)
          .addField('Description', 'Shows information about an island. It will offer suggestions if you get the name slightly wrong.')
        return msg.author.dmChannel.send(embed)
      }
      const request = await http.get(`${process.env.API_URL}/api/islands.json`)
      const islandData = request.data.features
      let island = null
      const islandID = args.join(' ')
      if (isNaN(parseInt(islandID))) {
        island = islandData.find(island => island.properties.nickName === islandID)
        if (!island) island = islandData.find(island => island.properties.name === islandID)
      }
      else {
        island = islandData.find(island => island.id === parseInt(islandID))
      }
      if (!island) {
        fuseOptions.keys = [
          { 
            name: 'properties.nickName',
            weight: 0.7
          },
          { 
            name:'properties.name',
            weight: 0.3
          }
        ]
        const fuse = new Fuse(islandData, fuseOptions)
        const results = fuse.search(args.join(' '))

        if (results.length === 0) {
          if (!msg.author.dmChannel) await msg.author.createDM()
          msg.author.dmChannel.send('No results!')
          return msg.channel.type === 'dm' ? null : msg.delete()
        }
        else if (results.length > 8) {
          if (!msg.author.dmChannel) await msg.author.createDM()
          msg.author.dmChannel.send('Too many search results! Please narrow it!')
          return msg.channel.type === 'dm' ? null : msg.delete()
        }
        else if (results.length !== 1) {
          msg.react('\u23F3')
          const searchEmbed = new Embed().setTitle('Did you mean...')
          let description = 'React with or type the letter of the island you meant to type!\n\n'
          let letters = []
          let emojis = []
          results.forEach((r, i) => {
            description += `:regional_indicator_${String.fromCharCode(97+i)}: ${r.item.properties.nickName || r.item.properties.name}\n`
            emojis.push(`${String.fromCharCode(55356)}${String.fromCharCode(56806 + i)}`)
            letters.push(String.fromCharCode(97+i))
          })
          searchEmbed.setDescription(description)
          if (!msg.author.dmChannel) await msg.author.createDM()
          const m = await msg.author.dmChannel.send(searchEmbed)
          const reactFilter = (reaction, user) => user.id === msg.author.id && emojis.includes(reaction.emoji.name)
          const msgFilter = am => am.author.id === msg.author.id
          let choice = null
          asyncForEach(emojis, async e => {
            if (!choice)
              await m.react(e)
          })
          let aReacts = m.awaitReactions(reactFilter, { max: 1, time: 30000 })
          let aMsgs = m.channel.awaitMessages(msgFilter, { max: 1, time: 30000})
          choice = await Promise.race([aReacts, aMsgs])
          if (choice.size === 0) {
            m.delete()
            if (!msg.author.dmChannel) await msg.author.createDM()
            msg.author.dmChannel.send('You did not make a selection!')
            return msg.channel.type === 'dm' ? null : msg.delete()
          }
          else {
            if (choice.first().content)
              island = results[letters.indexOf(choice.first().content.toLowerCase())].item
            else
              island = results[emojis.indexOf(choice.first().emoji.name)].item
          }
        }
        else
          island = results[0].item
      }
      const islandEmbed = new Embed()
      islandEmbed.setTitle(island.properties.nickName || island.properties.name)
        .setURL(island.properties.workshopUrl || null)
        .setImage(island.properties.imagePopup)
        .setThumbnail('https://map.cardinalguild.com/_nuxt/img/cd4d6e4.png')
        .setAuthor(island.properties.creator, null, island.properties.creatorWorkshopUrl || null)
        .addField('Tier', island.properties.tier, true)
        .addField('Altitude', island.properties.altitude, true)
        .addField('Culture', island.properties.type.slice(0, 1).toUpperCase() + island.properties.type.slice(1), true)
        .addField('Databanks', island.properties.databanks, true)
        .addField('Revival Chambers', `\`\`\`${island.properties.revivalChambers ? 'css\nYes' : 'diff\n- No'}\`\`\``, true)
        .addField('Turrets', `\`\`\`${island.properties.turrets ? 'diff\n- Yes' : 'css\nNo'}\`\`\``, true)
        .addField('Map Links', `[PvE](https://map.cardinalguild.com/pve/?island=${island.id})\n[PvP](https://map.cardinalguild.com/pvp/?island=${island.id})`, true)
        .addField('Survey by', `${island.properties.surveyCreatedBy}\n${island.properties.createdAt}`, true)
      switch (island.properties.tier) {
        case 1: {
          islandEmbed.setColor('#b1deab')
          break
        }
        case 2: {
          islandEmbed.setColor('#aecbf5')
          break
        }
        case 3: {
          islandEmbed.setColor('#e3c9f9')
          break
        }
        case 4: {
          islandEmbed.setColor('#f7c38f')
          break
        }
        default: {
          islandEmbed.setColor('RED')
        }
      }
      msg.clearReactions().then(() => {
        msg.react('\u2705')
      })
      msg.channel.send(islandEmbed)
      islandCmd.add(msg.author.id)
      setTimeout(() => {
        islandCmd.delete(msg.author.id)
      }, 10000)
    }
  }
})

bot.login(process.env.TOKEN)

'use strict'
const cote = require('cote')({statusLogsEnabled:false})
const u = require('@elife/utils')
const request = require('request')
const fs = require('fs')
const tssUtil = require('./tss-util')
const shortid = require('shortid') 
const path = require('path')
const os = require('os')
const https = require('https')
const http = require('http')

let ART_SERVICE_URL = process.env.ART_SERVICE_URL || 'http://149.202.214.34:8195/draw?'

/**
 *  understand/
 * This is the main entry point where we start.
 * 
 *   outcome/
 * Start our microservice and register with the communication manager
 * and SSB
 */
function main() {
  startMicroService()
  registerWithCommMgr()
  registerWithDirectMsg()
}

const directMsgClient = new cote.Requester({
  name: 'art seller ->  direct msg',
  key: 'everlife-dir-msg-demo-svc',
})


const ssbClient = new cote.Requester({
  name: 'direct-message -> SSB',
  key: 'everlife-ssb-svc',
})

const levelDbClient = new cote.Requester({
  name: 'art seller -> leveldb',
  key: 'everlife-db-svc',
})

function registerWithDirectMsg() {
  directMsgClient.send({
    type: 'register-direct-msg-handler',
    mskey: msKey,
    mstype: 'direct-msg'
  })
}

const commMgrClient = new cote.Requester({
  name: 'art seller -> CommMgr',
  key: 'everlife-communication-svc',
})

let msKey = 'eskill-art-seller-svc'

/*      outcome/
 * Register ourselves as a message handler with the communication
 * manager.
 */
function registerWithCommMgr() {
  commMgrClient.send({
      type: 'register-msg-handler',
      mskey: msKey,
      mstype: 'msg',
      mshelp: [ { cmd: '/buy_art', txt: 'send a requst to seller' } ],
  }, (err) => {
      if(err) u.showErr(err)
  })
}



function startMicroService() {
    /**
     *   understand/
     * The microService (partitioned by key to prevent conflicting with other services)
     */

    const svc = new cote.Responder({
        name: 'Art buyer skill',
        key: msKey
    })

    svc.on('msg', (req, cb) => {
      cb()
    })
    
    svc.on('direct-msg', (req, cb)  => {
      processMsg(req.msg, cb)
    })

}


function sendMsgOnLastChannel(req) {
  req.type = 'reply-on-last-channel'
  commMgrClient.send(req, (err) => {
      if(err) u.showErr(err)
  })
}

const ART_STYLE_KEY = 'art-style-seller'


function getStyle(cb) {
  levelDbClient.send({ type: 'get', key: LEVEL_DB_KEY },(err, val) =>{
      if(err || !val) {
          cb(null, ['muse','rain','scream','udnie','wave','wreck'].join())
      } else cb(null, val.join())
  })
}

/**
 *  outcome/
 * If this is a message for art buyer sent by art seller,
 * relay it to my owner over the last used channel
 * 
 * @param {*} msg 
 */
function processMsg(msg, cb) {
  console.log(msg)
  let text = msg.value.content.text
  if(text.startsWith('/buyer-art-req')) {
    let buyerWallet = msg.value.content.wallet
    let claim = msg.value.content.claim
    let style = msg.value.content.style 
    let imgBox = msg.value.content.text.replace('/buyer-art-req','').trim()
    let buyer = msg.value.author
    let ctx = msg.value.content.ctx
    cb(null, true)
    
    writeBoxValueTOFileInTmpDir(imgBox, (err, filePath) => {
      if(err) u.showErr(err)
      else {
        generateArtImg(style, filePath,(err, imgUrl) => {
          if(err) u.showErr(err)
          else {
            writeFileInTmpDir(imgUrl,(err, file) => {
              console.log(file)
              ssbClient.send({type:'box-blob-save-file',filePath: file},(err, boxValue) => {
                if(err) u.showErr(err)
                else {
                  tssUtil.seller_create_nft(boxValue +'', buyer, imgUrl)
                  .then((nft) => {
                    console.log(nft)
                    tssUtil.createSmartContract(buyerWallet, nft, claim)
                    .then((tx) => {
                      
                      let msg = `Here you go, it's ready: ${imgUrl} and this is the Stellar address of the NFT Asset and you can see that I'm the owner/signatory of this asset. ${nft}`
                      directMessage(null, '/art-image', buyer, msg, ctx, (err) => {
                        if(err) u.showErr(err)
                      })
                    }).catch((e)=>{
                      u.showErr(e)
                    })
                  }).catch((e)=>u.showErr(e))
                }
              })
            })

            
          }
        })
      }
    })
  }
   else {
    cb()
  }
}

function writeFileInTmpDir(fileUrl, cb) {
  
  let name = shortid.generate()
  
  let inFile = path.join(os.tmpdir(), name)
  
  const file = fs.createWriteStream(inFile);
  if(fileUrl.startsWith('https')) {
    https.get(fileUrl, function(response) {
      response.pipe(file);
      file.on('finish', ()=>{
        file.close()
        cb(null, inFile)
      })
    });
  } else {
    http.get(fileUrl, function(response) {
      response.pipe(file);
      file.on('finish', () => {
        file.close()
        cb(null, inFile)
      })
    }); 
  }

}


function writeBoxValueTOFileInTmpDir(boxValue, cb) {
  ssbClient.send({type:'unbox-blob-save-file', blobId: boxValue}, (err, filepath) => {
    if(err){
      console.log(err)
      cb(err)
    } 
    else {
      console.log(filepath)
      cb(null, filepath)
    }
  })
}

function generateArtImg(style, filePath, cb) {
  console.log(style)
  console.log(filePath)
  console.log('Generate Image')
  const options = {
    method:'POST',
    uri: ART_SERVICE_URL,
    formData: {
      img: fs.createReadStream(filePath),
      style: style
  
    }
  }
  request(options, (err, res, body) => {
    if(err) cb(err)
    else {
      try {
        cb(null, JSON.parse(body).img)
      } catch(e) {
        cb(e)
      }
    }
  });
}

/*      outcome/
 * Post a 'direct message' to someone on my feed and let the network
 * replicate it to the recipient
 */
function directMessage(req, type, userID, msg, ctx, cb) {
  let message = {
    type: 'direct-msg',
    to: userID,
    text: type + " " + msg,   
  }
  if(ctx) message['ctx'] = ctx
  ssbClient.send({
      type: 'new-msg',
      msg: message,
  }, cb)
}

const LEVEL_DB_KEY = 'art-service'

function storeArtStyle(avatarid, style) {
  console.log(avatarid + style)
  levelDbClient.send({type: 'put', key: LEVEL_DB_KEY + avatarid, val: JSON.stringify({style : style}) }, (err) => {
    if(err)u.showErr(err + '233')
  })
}

/**function storeClaimableBalanceId(avatarid, balanceId) {
  getAvatarArtDetails(avatarid,(err, data)=>{
    if(err) u.showErr(err)
    else {
      data[claimableBalanceId] = balanceId;
      levelDbClient.send( {type:'put', key: LEVEL_DB_KEY + avatarid, val: data }, (err) => {
        if(err) u.showErr(err)
      })
    }
  })
}
**/
function getAvatarArtDetails(avatarid, cb) {
  console.log(avatarid)
  levelDbClient.send({type: 'get', key: LEVEL_DB_KEY + avatarid}, (err, data) => {
    if(err){
      u.showErr('error ' +err)
      cb(err)
    } else {
      console.log(data)
      cb(null, JSON.parse(data))
    }
  })
} 

main()
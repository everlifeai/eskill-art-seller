'use strict'
const cote = require('cote')({statusLogsEnabled:false})
const u = require('@elife/utils')
const request = require('request')
const fs = require('fs')
const shortid = require('shortid') 
const path = require('path')
const os = require('os')
const https = require('https')
const http = require('http')

const tssUtil = require('./tss-util')

let ART_SERVICE_URL

/**
 *  understand/
 * This is the main entry point where we start.
 *
 *   outcome/
 * If we have a registered art service URL then start
 * our microservice and register with the communication manager
 * and SSB
 */
function main() {
  if(!loadConfigInfo()) return
  startMicroService()
  registerWithCommMgr()
  registerWithDirectMsg()
}

function loadConfigInfo() {
  ART_SERVICE_URL = v('ART_SERVICE_URL')
  if(!ART_SERVICE_URL) return

  const TSS = {}
  TSS.publicKey = v('TSS_PUBLIC_KEY')
  if(!TSS.publicKey) return
  TSS.url = v('TSS_URL')
  if(!TSS.url) return
  TSS.hash = v('TSS_HASH')
  if(!TSS.hash) return
  TSS.signer = v('TSS_SIGNER')
  if(!TSS.signer) return
  TSS.salePrice = v('TSS_SALE_PRICE')
  if(!TSS.salePrice) return
  TSS.txFunctionFee = v('TSS_TX_FN_FEE')
  if(!TSS.txFunctionFee) return


  tssUtil.init(TSS)

  return true

  function v(n) {
    if(process.env[n]) return process.env[n].trim()
  }
}

const directMsgClient = new cote.Requester({
  name: 'art seller ->  direct msg',
  key: 'everlife-dir-msg-svc',
})


const ssbClient = new cote.Requester({
  name: 'direct-message -> SSB',
  key: 'everlife-ssb-svc',
})

const commMgrClient = new cote.Requester({
  name: 'art seller -> CommMgr',
  key: 'everlife-communication-svc',
})

let msKey = 'eskill-art-seller-svc'

function registerWithDirectMsg() {
  directMsgClient.send({
    type: 'register-direct-msg-handler',
    mskey: msKey,
    mstype: 'direct-msg'
  })
}

/*      outcome/
 * Register ourselves as a message handler with the communication
 * manager.
 */
function registerWithCommMgr() {
  commMgrClient.send({
      type: 'register-msg-handler',
      mskey: msKey,
      mstype: 'msg',
      mshelp: [ { cmd: '/nft_info', txt: 'get nft info for debugging' } ],
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

  svc.on('direct-msg', (req, cb)  => {
    processMsg(req.msg, cb)
  })

  svc.on('msg', (req, cb) => {
    if(req.msg !== '/nft_info') return cb()
    cb(null, true)
    sendReply(JSON.stringify(tssUtil.getTSS(), 0, 2), req)
  })
}


function sendReply(msg, req) {
  req.type = 'reply'
  req.msg = String(msg)
  commMgrClient.send(req, (err) => {
      if(err) u.showErr(err)
  })
}


const ART_STYLE_KEY = 'art-style-seller'

/**
 *  outcome/
 * Process buyer of art requests
 */
function processMsg(msg, cb) {
  if(!msg.value.content.text.startsWith('/buyer-art-req')) return cb()

  const buyerWallet = msg.value.content.wallet
  const claim = msg.value.content.claim
  const style = msg.value.content.style
  const imgBox = msg.value.content.text.replace('/buyer-art-req','').trim()
  const buyer = msg.value.author
  const ctx = msg.value.content.ctx
  cb(null, true)

  writeBoxValueToFileInTmpDir(imgBox, (err, filePath) => {
    if(err) {
      u.showErr(err)
      directMessage('/art-image-err', buyer, 'Error getting picture', ctx, err => {
        if(err) u.showErr(err)
      })
      return
    }
    generateArtImg(style, filePath, (err, imgUrl) => {
      if(err) {
        u.showErr(err)
        directMessage('/art-image-err', buyer, 'Could not generate picture', ctx, err => {
          if(err) u.showErr(err)
        })
        return
      }
      writeFileInTmpDir(imgUrl, (err, file) => {
        if(err) {
          u.showErr(err)
          directMessage('/art-image-err', buyer, 'Could not generate picture', ctx, err => {
            if(err) u.showErr(err)
          })
          return
        }

        ssbClient.send({type:'box-blob-save-file',filePath: file},(err, boxValue) => {
          if(err) {
            u.showErr(err)
            directMessage('/art-image-err', buyer, 'Could not package picture to send you', ctx, err => {
              if(err) u.showErr(err)
            })
            return
          }

          tssUtil.seller_create_nft(boxValue +'', buyer, imgUrl)
            .then(nft => {
              tssUtil.deliverNFT(buyerWallet, nft, claim)
                .then(tx => {

                  let msg = `Here you go, it's ready: ${imgUrl} and this is the Stellar address of the NFT Asset and you can see that I'm the owner/signatory of this asset. ${nft}`
                  directMessage('/art-image', buyer, msg, ctx, err => { if(err) u.showErr(err) })

                }).catch(e => {
                  u.showErr(e)
                  directMessage('/art-image-err', buyer, 'Smart contract failed!', ctx, err => {
                    if(err) u.showErr(err)
                  })
                })

            }).catch(e => {
              u.showErr(e)
              directMessage('/art-image-err', buyer, 'Failed to create NFT asset!', ctx, err => {
                if(err) u.showErr(err)
              })
            })

        })
      })
    })
  })
}

function writeFileInTmpDir(fileUrl, cb) {
  let name = shortid.generate()
  let f = path.join(os.tmpdir(), name)

  const file = fs.createWriteStream(f);
  let m = http
  if(fileUrl.startsWith('https')) m = https
  m.get(fileUrl, resp => {
    resp.pipe(file)
    file.on('finish', ()=>{
      file.close()
      cb(null, f)
    })
  })
}


function writeBoxValueToFileInTmpDir(boxValue, cb) {
  ssbClient.send({type:'unbox-blob-save-file', blobId: boxValue}, cb)
}

function generateArtImg(style, filePath, cb) {
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
  })
}

/*      outcome/
 * Post a 'direct message' to someone on my feed and let the network
 * replicate it to the recipient
 */
function directMessage(type, userID, msg, ctx, cb) {
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

/*
const LEVEL_DB_KEY = 'art-service'

const levelDbClient = new cote.Requester({
  name: 'art seller -> leveldb',
  key: 'everlife-db-svc',
})


function storeArtStyle(avatarid, style) {
  levelDbClient.send({type: 'put', key: LEVEL_DB_KEY + avatarid, val: JSON.stringify({style : style}) }, (err) => {
    if(err)u.showErr(err + '233')
  })
}

function getStyle(cb) {
  levelDbClient.send({ type: 'get', key: LEVEL_DB_KEY },(err, val) =>{
      if(err || !val) {
          cb(null, ['muse','rain','scream','udnie','wave','wreck'].join())
      } else cb(null, val.join())
  })
}

function storeClaimableBalanceId(avatarid, balanceId) {
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

function getAvatarArtDetails(avatarid, cb) {
  levelDbClient.send({type: 'get', key: LEVEL_DB_KEY + avatarid}, (err, data) => {
    if(err){
      u.showErr('error ' +err)
      cb(err)
    } else {
      cb(null, JSON.parse(data))
    }
  })
}

**/

main()

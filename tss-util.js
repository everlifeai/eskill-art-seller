'use strict'
const StellarSdk = require('stellar-sdk')
const req = require('@tpp/req')

const LIVE_HORIZON = "https://horizon.stellar.org/"
const TEST_HORIZON = "https://horizon-testnet.stellar.org/"

function getSvr(horizon) {
  return new StellarSdk.Server(TEST_HORIZON)
}

function getNetworkPassphrase() {
  return StellarSdk.Networks.TESTNET
  //return StellarSdk.Networks.PUBLIC
}

const SELLER = {
  publicKey: 'GDKIYUR2X7Y44USYBCTQLVAAJNE5XEGSEJTUSR6LBEIUDYGWQMWKXFSN',
  secretKey: 'SAFYYRTEFHFPNBT4XGYKLIQS626BVJNFHXMGHCKGFVOLKKVM7X5URNMC',
}

let TSS
function init(tss_) { TSS = tss_ }

async function deliverNFT (buyerWallet, nft, claim) {
  const smartContract = await seller_xcute_tss(buyerWallet, nft, claim)
  return await seller_sign_and_deliver(smartContract)
}

function generate_nft(data) {
  const issuer = StellarSdk.Keypair.fromSecret(SELLER.secretKey)
  const signedObject = create_signed_object_1(issuer, data)
  const hash = StellarSdk.hash(Buffer.from(signedObject, 'utf8'))
  return get_keypair_1(hash)

  function get_keypair_1(hash) {
    return StellarSdk.Keypair.fromRawEd25519Seed(hash)
  }

  function create_signed_object_1(issuerKeys, data) {
    const json = JSON.stringify(data)
    const hash = StellarSdk.hash(Buffer.from(json, 'utf-8'))
    const signature = issuerKeys.sign(hash).toString('base64')
    return JSON.stringify({
      sig: signature,
      meta: data
    })
  }
}

async function seller_create_nft(hash, buyerAvatar, imgURL) {
  const server = getSvr()
  const acc = await server.loadAccount(SELLER.publicKey)

  const data = {
    id: hash,
    name: buyerAvatar,
    image_url: imgURL,
  }

  const nft = generate_nft(data)

  await activate_account_1()
  await set_signatories_1()

  return nft.publicKey()

  function activate_account_1() {
    const op = {
      destination: nft.publicKey(),
      startingBalance: "5",
    }

    const txn = new StellarSdk.TransactionBuilder(acc, { fee: StellarSdk.BASE_FEE, networkPassphrase: getNetworkPassphrase() })
      .addOperation(StellarSdk.Operation.createAccount(op))
      .setTimeout(180)
      .build()

    txn.sign(StellarSdk.Keypair.fromSecret(SELLER.secretKey))

    return server.submitTransaction(txn)
  }

  async function set_signatories_1() {
    const op1 = {
      signer: {
        ed25519PublicKey: TSS.signer,
        weight: 1,
      }
    }
    const op2 = {
      signer: {
        ed25519PublicKey: SELLER.publicKey,
        weight: 1,
      }
    }

    const acc = await server.loadAccount(nft.publicKey())

    const txn = new StellarSdk.TransactionBuilder(acc, { fee: StellarSdk.BASE_FEE, networkPassphrase: getNetworkPassphrase() })
      .addOperation(StellarSdk.Operation.setOptions(op1))
      .addOperation(StellarSdk.Operation.setOptions(op2))
      .setTimeout(180)
      .build()

    txn.sign(nft)

    return server.submitTransaction(txn)
  }
}

/*    way/
 * submit the nft and claim to the TSS to execute the smart contract
 */
async function seller_xcute_tss(buyerWallet, nft, claim) {

  const op = {
    nft_buyer: buyerWallet,
    nft_asset: nft,
    nft_seller: SELLER.publicKey,
    claimable_balance_id: claim,
    signer: TSS.signer,
    nft_sale_price: TSS.salePrice,
    txFunctionFee: TSS.txFunctionFee,
  }

  const u = `${TSS.url}/tx-functions/${TSS.hash}`

  const resp = await reqP(u, op)

  return resp
}

/*    way/
 * sign and deliver smart contract to claim fee and hand NFT to buyer
 */
async function seller_sign_and_deliver(smartContract) {

  const server = getSvr()

  const txn = new StellarSdk.Transaction(smartContract.xdr, getNetworkPassphrase())
  txn.addSignature(smartContract.signer, smartContract.signature)

  return await server.submitTransaction(txn)
}


function reqP(url, data) {
  return new Promise((res,rej) => {
    req.post(url, data, (err, resp) => {
      if(err) rej(err)
      else res(resp.body)
    })
  })
}

module.exports = {
  init,
  seller_create_nft,
  deliverNFT
}

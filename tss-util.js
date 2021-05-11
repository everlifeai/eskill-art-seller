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

const TSS = {
  publicKey: 'GAMGW7ZESFF2KVGL7EMBBIAXTFAOF3MNI2JBWSPLTGMAKOSVLHDNZMA2',
  url: 'http://tss-wrangler.everlife.workers.dev',
  hash: 'aaa4d948605fa72d00b3902483ed6670698c5c1c8f05a190237da609a87290a2',
  signer: 'GCYTED6QWSGDNLQ2RBXDVYSKCOUB2BC6DLKGAU5QPNONMVN47ABUN6WE',
  salePrice: "420",
  txFunctionFee: "AAAAAgAAAADUjFI6v/HOUlgIpwXUAEtJ25DSImdJR8sJEUHg1oMsqwAAAGQAAphYAAAADAAAAAEAAAAAAAAAAAAAAAAAAAAAAAAAA6qk2UhgX6ctALOQJIPtZnBpjFwcjwWhkCN9pgmocpCiAAAAAQAAAAAAAAABAAAAABhrfySRS6VUy/kYEKAXmUDi7Y1GkhtJ65mYBTpVWcbcAAAAAAAAAAABMS0AAAAAAAAAAAHWgyyrAAAAQBL7TW9Q45FNU1Zy/YLSArozCxlMlGk65WddNGSVgqJuosdgcv7+p7rV2jFWBonpJRrh/fFnC3ieKuiOiq8VDAM=",
}


/*    understand/
 * main entry point into our program
 *
 *    way/
 * 1. Buyer creates claimable balance and gives to seller
 * 2. Seller generates NFT
 * 3. Seller executes smart contract on TSS
 * 4. Seller signs and executes the smart contract transferring
 * ownership to buyer
 *
 * TODO: note that txFunctionFee needs to be occasionally created as a
 * payment of 1 or 2 XLM to the TSS public key with the memo holding a
 * hash of the function
 */

async function createSmartContract (buyerWallet, nft, claim) {
  
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
  seller_create_nft,
  createSmartContract
}
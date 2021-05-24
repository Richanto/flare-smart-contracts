require('dotenv').config()
const fs = require('fs')
const qs = require('qs')
const Web3 = require('web3')
const axios = require('axios')
const express = require('express')

const port = 3000
const provider = 'https://coston-api-sc.flare.rocks/ext/bc/C/rpc'
const web3Provider = new Web3.providers.HttpProvider(provider)
const web3 = new Web3(web3Provider)

const addresses = JSON.parse(fs.readFileSync('../flare-smart-contracts/deploys/ftsoMvpNetwork.json','utf8'))
const ftsoAbi = JSON.parse(fs.readFileSync('../flare-smart-contracts/artifacts/contracts/implementations/Ftso.sol/Ftso.json','utf8')).abi
const ftsoManagerAbi = JSON.parse(fs.readFileSync('../flare-smart-contracts/artifacts/contracts/implementations/FtsoManager.sol/FtsoManager.json','utf8',),).abi
const ftsoManagerAddress = (() => {
  let res
  addresses.forEach((contract) => {
      if (contract.name === "FtsoManager") {
          res = contract.address
      }
  })
  return res
})()

;(async () => {
  let app = express()
  app.use(express.urlencoded({extended: true}))
  app.use(express.json())
  app.listen(process.env.PORT || port, function () {
    console.log(`Example app listening on port ${port}`)
  })

  let ftsoManager = new web3.eth.Contract(ftsoManagerAbi,ftsoManagerAddress,)
  let ftsos = await ftsoManager.methods.getFtsos().call()
  let ftsoData = []
  
  for (let i = 0; i < ftsos.length; i++) {
    let fasset = await new web3.eth.Contract(ftsoAbi, ftsos[i])
    ftsoData.push({
      symbol: await fasset.methods.symbol().call(),
      address: ftsos[i],
      contract: fasset,
    })
  }

  let decimal = await ftsoData[0].contract.methods.FASSET_USD_DECIMALS.call().call()
  let errorBody = {
    mkdwn: true,
    text: `Invalid inputs `,
    attachments: [
      {
        color: 'danger',
        text: `Inputs not in order/missing `,
      },
    ],
  }

  /**
   * Adds app to any slack workspace
   * @dev CLIENT_ID can be generated by creating a new app at api.slack.com
   * 
   */
  app.get('/slack', function (req, res) {
    res.send('<h2>Flare slack app</h2><br><a href="https://slack.com/oauth/v2/authorize?scope=incoming-webhook&client_id='+process.env.CLIENT_ID+'"><img alt=""Add to Slack"" height="40" width="139" src="https://platform.slack-edge.com/img/add_to_slack.png" srcset="https://platform.slack-edge.com/img/add_to_slack.png 1x, https://platform.slack-edge.com/img/add_to_slack@2x.png 2x" /></a>')  })

  /**
   * Authorizes the slack account of the user that installs this app to any workspace.
   * This function can also be used to create a database of details like 
    -who installed this app(username,email)
    -where
    -which workspace
    -which channel
    -total number of times this app got installed.
   */
  app.get('/slack/auth/redirect', async function (req, res) {
    try {
      let code = req.query.code
      let url = 'https://slack.com/api/oauth.v2.access'
      let data = qs.stringify({
        client_id: process.env.CLIENT_ID,
        client_secret: process.env.CLIENT_SECRET,
        code,
      })
      let headers = {
        'Content-Type': 'application/x-www-form-urlencoded',
      }
      await axios.post(url, data, { headers })
      res.send('Successfully installed flare slack app')
    } catch (e) {
      console.log(e)
      res.send('Failed to install flare slack app')
    }
  })

  app.post('/slack/list_ftso', function (req, res) {
    ;(async () => {
      res.send(await list_ftso(req))
    })()
  })

  app.post('/slack/ftso_epochid', function (req, res) {
    ;(async () => {
      res.send(await ftso_epochid(req))
    })()
  })

  app.post('/slack/ftso_epoch', function (req, res) {
    ;(async () => {
      res.send(await ftso_epoch(req))
    })()
  })

  app.post('/slack/currentprice', function (req, res) {
    ;(async () => {
      res.send(await currentprice(req))
    })()
  })

  app.post('/slack/ftso_price', function (req, res) {
    ;(async () => {
      res.send(await ftso_price(req))
    })()
  })

  app.post('/slack/epoch_price_for_voter', function (req, res) {
    ;(async () => {
      res.send(await epoch_price_for_voter(req))
    })()
  })

  app.post('/slack/ftso_votes', function (req, res) {
    ;(async () => {
      res.send(await ftso_votes(req))
    })()
  })


    /** Internal Function - 
     * @notice                         evaluates ftso id to respective address and optional epoch id to default
     * @param _firstInput              ftso id or ftso address
     * @param _secondInput             epoch id (optional,default last calculated epoch id)
     * @notice                         returns ftso address, epoch id for caller function to use
     */
    async function _validateInput(_firstInput, _secondInput) {
    let callingAddress,callingEpochId
    let address_given = ftsos.includes(_firstInput)
    if (address_given && _secondInput) {
      callingAddress = _firstInput
      callingEpochId = _secondInput
    } else if (address_given && !_secondInput) {
      callingAddress = _firstInput
      callingEpochId = await ftsoData[1].contract.methods.getCurrentEpochId().call() - 1
    } else if (!address_given && _firstInput <= ftsos.length && _secondInput) {
      callingAddress = ftsos[_firstInput]
      callingEpochId = _secondInput
    } else if (!address_given && _firstInput <= ftsos.length && !_secondInput) {
      callingAddress = ftsos[_firstInput]
      callingEpochId = await ftsoData[1].contract.methods.getCurrentEpochId().call() - 1
    } else {
      callingAddress = ftsos[1]
      callingEpochId = await ftsoData[1].contract.methods.getCurrentEpochId().call() - 1
    }
    return [callingAddress, callingEpochId]
  }

    /**
     * Returns FTSOs details  - id, address, name, asset price(USD)
     */
    async function _list_ftso(responseUrl) {
    let js = 'Index\tcontract address\tasset name\tlast $ price\n'
    for (let i = 0; i < 8; i++) {
      js += `${i}\t${ftsoData[i].address}\t${ftsoData[i].symbol}\t${
        (await ftsoData[i].contract.methods.getCurrentPrice().call()) / 10 ** decimal
      }\n`
    }
    let slackBody = {
      mkdwn: true,
      text: `FTSOs`,
      attachments: [
        {
          color: 'good',
          text: ` ${js}`,
        },
      ],
    }
    axios.post(responseUrl, slackBody)
  }

  //////////////////////////////
  async function list_ftso(req) {
    responseUrl = req.body.response_url
    _list_ftso(responseUrl, req)
    return
  }

  /**
   * Returns current epoch id if no input
   * Returns epoch id at timestamp given as input
   */
  async function _ftso_epochid(responseUrl, req) {
    let flag
    let result
    let timestamp = req.body.text
    if (timestamp.trim() == '') {
      flag = true
      result = await ftsoData[1].contract.methods.getCurrentEpochId().call()
    } else {
      result = await ftsoData[1].contract.methods.getEpochId(timestamp).call()
    }

    let slackBody = {
      mkdwn: true,
      text: `FTSO Epoch Id`,
      attachments: [
        {
          color: 'good',
          text: flag
            ? `Current epoch id: ${result}`
            : `Epoch id at ${timestamp}: ${result}`,
        },
      ],
    }
    axios.post(responseUrl, slackBody)
  }

  //////////////////////////////
  async function ftso_epochid(req) {
    responseUrl = req.body.response_url
    _ftso_epochid(responseUrl, req)
    return
  }

  /**
   * Returns last median calculation results of given Ftso id/address and epoch id (optional)
   */
  async function _ftso_epoch(responseUrl, req) {
    let result = ''
    let raw = req.body.text
    inputs = raw.split(',')

    firstInput = inputs[0]
    secondInput = inputs[1]
    firstInput = firstInput || undefined
    secondInput = secondInput || undefined
    let res = await _validateInput(firstInput, secondInput)
    let [callingAddress, callingEpochId] = res
    let id = ftsos.indexOf(callingAddress)
    try {
      await ftsoData[id].contract.methods
        .getFullEpochReport(callingEpochId)
        .call()
        .then((data) => {
          let size = Object.keys(data).length
          for (var i = 0; i <= size / 2; i++) {
            delete data[i]
          }
          for (j in data) {
            result += `${j.slice(1)}: ${data[j]}\n`
          }
        })

      let slackBody = {
        mkdwn: true,
        text: `Epoch details for ${callingAddress} (${ftsoData[id].symbol}) at epoch id ${callingEpochId}`,
        attachments: [
          {
            color: 'good',
            text: `${result}`,
          },
        ],
      }
      axios.post(responseUrl, slackBody)
    } catch {
      axios.post(responseUrl, errorBody)
    }
  }

  //////////////////////////////
  async function ftso_epoch(req) {
    responseUrl = req.body.response_url
    _ftso_epoch(responseUrl, req)
    return
  }

  /**
   * Returns USD price of FTSO asset given as input
   */
  async function _currentprice(responseUrl, req) {
    input = req.body.text || undefined
    let res = await _validateInput(input, 0)
    let callingAddress = res[0]

    let id = ftsos.indexOf(callingAddress)
    try {
      let result = (await ftsoData[id].contract.methods.getCurrentPrice().call()) / 10 ** decimal
      let slackBody = {
        mkdwn: true,
        text: `Current Price for ${callingAddress} (${ftsoData[id].symbol}) `,
        attachments: [
          {
            color: 'good',
            text: `${result}`,
          },
        ],
      }
      axios.post(responseUrl, slackBody)
    } catch {
      axios.post(responseUrl, errorBody)
    }
  }

  //////////////////////////////
  async function currentprice(req) {
    responseUrl = req.body.response_url
    _currentprice(responseUrl, req)
    return
  }

  /**
   * returns price(USD) of FTSO asset at given epoch id
   */
  async function _ftso_price(responseUrl, req) {
    let raw = req.body.text
    inputs = raw.split(',')

    firstInput = inputs[0]
    secondInput = inputs[1]
    firstInput = firstInput || undefined
    secondInput = secondInput || undefined

    let res = await _validateInput(firstInput, secondInput)
    let [callingAddress, callingEpochId] = res

    let id = ftsos.indexOf(callingAddress)
    try {
      let result = (await ftsoData[id].contract.methods.getEpochPrice(callingEpochId).call()) / 10 ** decimal
      let slackBody = {
        mkdwn: true,
        text: `Epoch Price for ${callingAddress} (${ftsoData[id].symbol}) at epoch id ${callingEpochId}`,
        attachments: [
          {
            color: 'good',
            text: `${result}`,
          },
        ],
      }
      axios.post(responseUrl, slackBody)
    } catch {
      axios.post(responseUrl, errorBody)
    }
  }

  //////////////////////////////
  async function ftso_price(req) {
    responseUrl = req.body.response_url
    _ftso_price(responseUrl, req)
    return
  }

  /**
   * Returns price(USD) of FTSO Fasset at given epoch id for a particular voter
   */
  async function _epoch_price_for_voter(responseUrl, req) {
    let raw = req.body.text
    let res
    let inputs = raw.split(',')
    let firstInput = inputs[0]
    let secondInput = inputs[1]
    let thirdInput = inputs[2]
    firstInput = firstInput || undefined
    secondInput = secondInput || undefined
    if (web3.utils.isAddress(secondInput)) {
      thirdInput = secondInput
      secondInput = undefined
      res = await _validateInput(firstInput, secondInput)
    } else {
      res = await _validateInput(firstInput, secondInput)
    }
    let [callingAddress, callingEpochId] = res
    let id = ftsos.indexOf(callingAddress)
    try {
      let result = (await ftsoData[id].contract.methods.getEpochPriceForVoter(callingEpochId, thirdInput).call()) / 10 ** decimal
      let slackBody = {
        mkdwn: true,
        text: `Epoch Price for ${callingAddress} (${ftsoData[id].symbol}) at epoch id ${callingEpochId} for voter ${thirdInput}`,
        attachments: [
          {
            color: 'good',
            text: `${result}`,
          },
        ],
      }
      axios.post(responseUrl, slackBody)
    } catch {
      axios.post(responseUrl, errorBody)
    }
  }

  //////////////////////////////
  async function epoch_price_for_voter(req) {
    responseUrl = req.body.response_url
    _epoch_price_for_voter(responseUrl, req)
    return
  }

  /**
   * Returns vote details of FTSO asset at given epoch id
   */
  async function _ftso_votes(responseUrl, req) {
    let result = ''
    let user_input = req.body.text
    inputs = user_input.split(',')

    firstInput = inputs[0]
    secondInput = inputs[1]
    firstInput = firstInput || undefined
    secondInput = secondInput || undefined

    let res = await _validateInput(firstInput, secondInput)
    let [callingAddress, callingEpochId] = res
    let id = ftsos.indexOf(callingAddress)

    try {
      await ftsoData[id].contract.methods
        .getEpochVotes(callingEpochId)
        .call()
        .then((data) => {
          for (var i = 0; i <= 5; i++) {
            delete data[i]
          }

          head = Object.keys(data)
          for (i in head) {
            result += `${head[i].slice(1)}\t`
          }
          result += '\n'
          for (i in data[head[0]]) {
            for (j in head) {
              result += data[head[j]][i] + '\t'
            }
            result += '\n'
          }
        })

      let slackBody = {
        mkdwn: true,
        text: `Epoch Votes for ${callingAddress} (${ftsoData[id].symbol}) at epoch id ${callingEpochId}`,
        attachments: [
          {
            color: 'good',
            text: `${result}`,
          },
        ],
      }
      axios.post(responseUrl, slackBody)
    } catch {
      axios.post(responseUrl, errorBody)
    }
  }

  //////////////////////////////
  async function ftso_votes(req) {
    responseUrl = req.body.response_url
    _ftso_votes(responseUrl, req)
    return
  }
})()
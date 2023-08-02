const { namespaceWrapper } = require('./namespaceWrapper');
const TwitterTask = require('./twitter-task');
const { LAMPORTS_PER_SOL } = require("@_koi/web3.js");


class CoreLogic {
  constructor() {
    this.twitterTask = null;
  }

  async task() {
    // we will work to create a proof that can be submitted to K2 to claim rewards
    let proof_cid;

    // in order for this proof to withstand scrutiny (see validateNode, below, for audit flow) the proof must be generated from a full round of valid work

    // the following function starts the crawler if not already started, or otherwise fetches a submission CID for a particular round
    let round = await namespaceWrapper.getRound();
    if ( !this.twitterTask || !this.twitterTask.isRunning ) { // TODO - could be causing memory leaks
      try {
        this.twitterTask = await new TwitterTask (namespaceWrapper.getRound, round);
        console.log('started a new crawler at round', round);
      } catch (e) {
        console.log('error starting crawler', e);
      }
    
    } else {
      console.log('crawler already running at round', round);
    } 
  }

  /**
   * @fetchSubmission
   * @description This function is called by the Koi core to fetch the submission values
   *              before the node makes it's submission to claim rewards at the end of each round
   * @param {string} round
   * @returns {string} cid
   */
  async fetchSubmission() {
    console.log('fetchSubmission called');
    let round = await namespaceWrapper.getRound() 
    let lastRound = round - 1;

    if ( lastRound < 0 ) lastRound = 0;

    const cid = await this.twitterTask.getRoundCID(lastRound);

    console.log('about to make submission with CID: ', cid);

    return cid;

  }

  /**
   * generateDistributionList
   * @param {*} round 
   * @param {*} _dummyTaskState 
   * @description This function is called by the Koi core to generate the distribution list
   *             before the node makes it's submission to claim rewards at the end of each round
   *            The distribution list is a JSON object with the following structure:
   *           {
   *            "address1": 0.1,
   *           "address2": 0.2,
   *          "address3": 0.3,
   *         "address4": 0.4
   *        } where each address is the address of a validator node and the value is the percentage of the reward that the node will receive
   * @returns 
   */
  async generateDistributionList(round, _dummyTaskState) {
    try {
      console.log('GenerateDistributionList called');
      console.log('I am selected node');

      // Write the logic to generate the distribution list here by introducing the rules of your choice

      /*  **** SAMPLE LOGIC FOR GENERATING DISTRIBUTION LIST ******/

      let distributionList = {};
      let taskAccountDataJSON = await namespaceWrapper.getTaskState();
      if (taskAccountDataJSON == null) taskAccountDataJSON = _dummyTaskState;
      const submissions = taskAccountDataJSON.submissions[round];
      const submissions_audit_trigger =
        taskAccountDataJSON.submissions_audit_trigger[round];
      if (submissions == null) {
        console.log('No submisssions found in N-2 round');
        return distributionList;
      } else {
        const keys = Object.keys(submissions);
        const values = Object.values(submissions);
        const size = values.length;
        console.log('Submissions from last round: ', keys, values, size);
        for (let i = 0; i < size; i++) {
          const candidatePublicKey = keys[i];
          if (
            submissions_audit_trigger &&
            submissions_audit_trigger[candidatePublicKey]
          ) {
            console.log(
              submissions_audit_trigger[candidatePublicKey].votes,
              'distributions_audit_trigger votes ',
            );
            const votes = submissions_audit_trigger[candidatePublicKey].votes;
            let numOfVotes = 0;
            for (let index = 0; index < votes.length; index++) {
              if (votes[index].is_valid) numOfVotes++;
              else numOfVotes--;
            }
            if (numOfVotes < 0) continue;
          }

          // now we need to parse the value submitted and decide how much to pay
          let cid = values[i].submission_value;
          console.log(`about to fetch ${cid} from IPFS`)
          // let ipfs_object = this.twitterTask.getJSONofCID(cid);
          // if (ipfs_object == null || !ipfs_object) {
          //   distributionList[candidatePublicKey] = 0;
          // } else {
          //   if (ipfs_object.length == null || ipfs_object.length < 1) ipfs_object.length = 1;
          //   let score = ipfs_object.length * 0.1; // multiply total records submitted by value per record (0.1 KOII)
          //   distributionList[candidatePublicKey] = score;
          // }

          distributionList[candidatePublicKey] = 1 * LAMPORTS_PER_SOL;
        }
      }
      console.log('Distribution List', distributionList);
      return distributionList;
    } catch (err) {
      console.log('ERROR IN GENERATING DISTRIBUTION LIST', err);
    }
  }

  /**
   * submitDistributionList
   * @description This function is called by the Koi core to submit the distribution list
   *             after the node makes it's submission to claim rewards at the end of each round
   * @param {*} distributionList // must be populated by generateDistributionList
   * @param {*} round 
   * @returns
   * @memberof Node
   */
  async submitDistributionList(round) {
    // This function just upload your generated dustribution List and do the transaction for that

    console.log('SubmitDistributionList called');

    try {
      const distributionList = await this.generateDistributionList(round);

      const decider = await namespaceWrapper.uploadDistributionList(
        distributionList,
        round,
      );
      console.log('DECIDER', decider);

      if (decider) {
        const response =
          await namespaceWrapper.distributionListSubmissionOnChain(round);
        console.log('RESPONSE FROM DISTRIBUTION LIST', response);
      }
    } catch (err) {
      console.log('ERROR IN SUBMIT DISTRIBUTION', err);
    }
  }

  /**
   * validateNode
   * @description This function is called auditSubmission() to validate the submission value
   *           submitted by the node at the end of each round, and uses the more extensive
   *         validation logic in twitter-task.js to determine if the node is eligible for rewards  
   * @param {*} submission_value
   * @param {*} submission_value 
   * @param {*} round 
   * @returns 
   */
  async validateNode(submission_value, round) {
    return await this.twitterTask.validate(submission_value, round);
  }

  /**
   * shallowEqual
   * @description This function is called by the Koi core to compare the submission values
   * 
   * @param {*} object1 
   * @param {*} object2 
   * @returns 
   */
  async shallowEqual(object1, object2) {
    const keys1 = Object.keys(object1);
    const keys2 = Object.keys(object2);
    if (keys1.length !== keys2.length) {
      return false;
    }
    for (let key of keys1) {
      if (object1[key] !== object2[key]) {
        return false;
      }
    }
    return true;
  }

  /**
   * validateDistribution
   * @description This function is called by the Koi core to validate the distribution list 
   *              and piggybacks off of generateDistributionList
   * @param {*} distributionListSubmitter
   * @param {*} round
   * @param {*} _dummyDistributionList
   * @param {*} _dummyTaskState
   * @returns
   * @memberof Node
   */
  validateDistribution = async (
    distributionListSubmitter,
    round,
    _dummyDistributionList,
    _dummyTaskState,
  ) => {
    // Write your logic for the validation of submission value here and return a boolean value in response
    // this logic can be same as generation of distribution list function and based on the comparision will final object , decision can be made
    return true;
    // try {
    //   console.log('Distribution list Submitter', distributionListSubmitter);
    //   const rawDistributionList = await namespaceWrapper.getDistributionList(
    //     distributionListSubmitter,
    //     round,
    //   );
    //   let fetchedDistributionList;
    //   if (rawDistributionList == null) {
    //     fetchedDistributionList = _dummyDistributionList;
    //   } else {
    //     fetchedDistributionList = JSON.parse(rawDistributionList);
    //   }
    //   console.log('FETCHED DISTRIBUTION LIST', fetchedDistributionList);
    //   const generateDistributionList = await this.generateDistributionList(
    //     round,
    //     _dummyTaskState,
    //   );

    //   // compare distribution list

    //   const parsed = fetchedDistributionList;
    //   console.log(
    //     'compare distribution list',
    //     parsed,
    //     generateDistributionList,
    //   );
    //   const result = await this.shallowEqual(parsed, generateDistributionList);
    //   console.log('RESULT', result);
    //   return result;
    // } catch (err) {
    //   console.log('ERROR IN VALIDATING DISTRIBUTION', err);
    //   return false;
    // }
  };
  
  /**
   * submitTask
   * @description This function is called by the Koi core to submit the submission value
   *             at the end of each round
   * @param {*} roundNumber 
   * @returns Promise<void>
   */
  async submitTask(roundNumber) {
    console.log('submitTask called with round', roundNumber);
    try {
      console.log('inside try');
      console.log(
        await namespaceWrapper.getSlot(),
        'current slot while calling submit',
      );
      const submission = await this.fetchSubmission();
      console.log('SUBMISSION', submission);
      await namespaceWrapper.checkSubmissionAndUpdateRound(
        submission,
        roundNumber,
      );
      console.log('after the submission call');
    } catch (error) {
      console.log('error in submission', error);
    }
  }

  /**
   * auditTask
   * @description This function is called by the Koi core to audit the submission value
   *            at the end of each round
   * @param {*} roundNumber
   * @returns Promise<void>
   * @memberof Node
   */
  async auditTask(roundNumber) {
    console.log('auditTask called with round', roundNumber);
    console.log(
      await namespaceWrapper.getSlot(),
      'current slot while calling auditTask',
    );
    await namespaceWrapper.validateAndVoteOnNodes(
      this.validateNode,
      roundNumber,
    );
  }

  /**
   * auditDistribution
   * @description This function is called by the Koi core to audit the distribution list
   *           at the end of each round
   * @param {*} roundNumber
   * @returns Promise<void>
   * @memberof Node
   */
  
  async auditDistribution(roundNumber) {
    console.log('auditDistribution called with round', roundNumber);
    await namespaceWrapper.validateAndVoteOnDistributionList(
      this.validateDistribution,
      roundNumber,
    );
  }
}
const coreLogic = new CoreLogic();

module.exports = { coreLogic };

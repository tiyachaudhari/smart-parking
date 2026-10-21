const { getPool } = require('../db');

function startExpireLocksJob() {
  // Run every 30 seconds
  setInterval(async () => {
    const pool = getPool();
    if (!pool) return;
    
    try {
      await pool.query('CALL sp_expire_locks()');
      // console.log('Ran sp_expire_locks job'); // Too noisy to log every 30s
    } catch (err) {
      console.error('Error running sp_expire_locks:', err);
    }
  }, 30 * 1000);
  
  console.log('Started background job: Expire Locks (30s interval)');
}

module.exports = {
  startExpireLocksJob
};

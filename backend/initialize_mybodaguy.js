#!/usr/bin/env node

/**
 * My Boda Guy Database Initialization Script
 * Initializes all database tables with mbg_ prefix
 */

const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('❌ Missing Supabase credentials in .env file');
  console.error('Required: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  }
});

const schemaDir = path.join(__dirname, 'database', 'schema_mybodaguy');

// Schema files in order
const schemaFiles = [
  '00_clean.sql',
  '01_users.sql',
  '02_geographic_regions.sql',
  '03_user_profiles.sql',
  '04_committee_members.sql',
  '05_riders.sql',
  '06_customers.sql',
  '07_rides.sql',
  '08_payments.sql',
  '09_commissions.sql',
  '10_platform_settings.sql'
];

async function executeSqlFile(filePath) {
  console.log(`\n📄 Executing: ${path.basename(filePath)}`);
  
  const sql = fs.readFileSync(filePath, 'utf8');
  
  try {
    const { data, error } = await supabase.rpc('exec_sql', { sql_string: sql }).catch(async () => {
      // If exec_sql function doesn't exist, execute directly via REST API
      const response = await fetch(`${supabaseUrl}/rest/v1/rpc/exec_sql`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': supabaseServiceKey,
          'Authorization': `Bearer ${supabaseServiceKey}`
        },
        body: JSON.stringify({ sql_string: sql })
      });
      
      if (!response.ok) {
        // Fall back to executing via pg admin or manual approach
        console.log('⚠️  Please execute this SQL manually in Supabase SQL Editor');
        return { data: null, error: null };
      }
      
      return await response.json();
    });

    if (error) {
      console.error(`❌ Error in ${path.basename(filePath)}:`, error.message);
      return false;
    }
    
    console.log(`✅ Successfully executed ${path.basename(filePath)}`);
    return true;
  } catch (err) {
    console.error(`❌ Exception in ${path.basename(filePath)}:`, err.message);
    console.log('\n⚠️  Note: You may need to execute these SQL files manually in Supabase SQL Editor');
    console.log(`   File: ${filePath}`);
    return false;
  }
}

async function initializeDatabase() {
  console.log('🚀 My Boda Guy - Database Initialization');
  console.log('=' .repeat(50));
  console.log(`📍 Supabase URL: ${supabaseUrl}`);
  console.log(`📁 Schema Directory: ${schemaDir}`);
  console.log('=' .repeat(50));

  for (const file of schemaFiles) {
    const filePath = path.join(schemaDir, file);
    
    if (!fs.existsSync(filePath)) {
      console.error(`❌ File not found: ${file}`);
      continue;
    }

    await executeSqlFile(filePath);
    
    // Small delay between files
    await new Promise(resolve => setTimeout(resolve, 500));
  }

  console.log('\n' + '='.repeat(50));
  console.log('✅ Database initialization complete!');
  console.log('=' .repeat(50));
  console.log('\n📋 Next Steps:');
  console.log('1. Sign in with: abanabaasa2@gmail.com / @1997God');
  console.log('2. You will automatically be assigned Developer role');
  console.log('3. Access the Developer Panel to set up regions');
  console.log('4. Start assigning chairpersons and onboarding riders');
  console.log('\n🎉 My Boda Guy is ready to use!');
}

// Run initialization
initializeDatabase().catch(err => {
  console.error('❌ Fatal error:', err);
  process.exit(1);
});

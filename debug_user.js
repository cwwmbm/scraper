import {performance} from 'perf_hooks';
import axios, { all } from 'axios';
import { load } from 'cheerio';
import { SocksProxyAgent } from 'socks-proxy-agent';
import { createClient } from '@supabase/supabase-js'
import { LocalStorage } from 'node-localstorage'
import { v4 as uuidv4 } from 'uuid';

import dotenv from 'dotenv';
// import { is } from 'cheerio/lib/api/traversing';
dotenv.config({ path: './.env.local' });

const agent = new SocksProxyAgent(process.env.PROXY);

async function signIn(supabase){
    const res = await supabase.auth.signInWithPassword({
      email: process.env.EMAIL,
      password: process.env.PASSWORD,
    });
    
    return res;
  }

function getCurrentTime(){
    const date = new Date();
    const year = date.getFullYear();
    const month = date.getMonth()+1;
    // console.log ("month: ", month);
    const day = date.getDate();
    const hours = date.getHours();
    const minutes = date.getMinutes();
    const seconds = date.getSeconds();
    const currentTime = `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
    return currentTime;
}
function convertDateToTimestamp(dateString) {
    // Parse the string into a Date object
    const dateObj = new Date(`${dateString}T00:00:00Z`); // Explicitly set time and timezone
    // check if the date is empty
    if (!dateString) return getCurrentTime();

    // Check if the date is valid
    if (isNaN(dateObj.getTime())) {
        throw new Error(`Invalid date: ${dateString}`);
    }

    // Format to 'YYYY-MM-DD HH:MM:SS'
    return `${dateString} 00:00:00`;
}

async function main() {
    global.localStorage = new LocalStorage("./scratch");
    const supabase = createClient(process.env.URL, process.env.KEY,{auth: {storage: global.localStorage,},})
    const supa = await signIn(supabase); //Signing into Supabase
    const cleanup = true;
    const user_id = '54693509-9f1c-4360-8d03-b1e138f698b6';
    const admin_id = 'ef32ddc4-338c-4978-838b-fce1fa4f03c9';
    const admin_profile_id = 'a6972ca8-2550-4333-8729-c1ad884f5322';
    if (cleanup) {
        const {data, error} = await supabase.from('user_jobs').delete().eq('user_id', admin_id);
        if (error) {
            console.log("error: ", error);
        }
        else {
            console.log("data: ", data);
        }
    } else {
        const user_jobs = await supabase.from('user_jobs').select('*').eq('user_id', user_id);
        const queriesRes = await supabase.from('job_queries').select('*').eq('user_id', user_id);

        //duplicate user_jobs for admin_user
        for (let i = 0; i < user_jobs.data.length; i++) {
            let job = user_jobs.data[i];
            job.user_id = admin_id;
            job.job_profile = admin_profile_id;
            delete job.id;

            const {data, error} = await supabase.from('user_jobs').insert([job]).select('*');
            if (error) {
                console.log("error: ", error);
            }
            else {
                console.log("data: ", data);
            }
        }
        //duplicate job_queries for admin_user
        for (let i = 0; i < queriesRes.data.length; i++) {
            let query = queriesRes.data[i];
            query.user_id = admin_id;
            query.profile_id = admin_profile_id;
            delete query.id;

            const {data, error} = await supabase.from('job_queries').insert([query]).select('*');
            if (error) {
                console.log("error: ", error);
            }
            else {
                console.log("data: ", data);
            }
        }
    }

    // console.log("user_jobs: ", user_jobs);

    // console.log("queriesRes: ", queriesRes);
}

await main();
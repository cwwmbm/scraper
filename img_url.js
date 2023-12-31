import {performance} from 'perf_hooks';
import axios from 'axios';
import { load } from 'cheerio';
import { SocksProxyAgent } from 'socks-proxy-agent';
import { createClient } from '@supabase/supabase-js'
import { LocalStorage } from 'node-localstorage'
import { v4 as uuidv4 } from 'uuid';
import { proxyOptions, email, password, url, key } from './settings.js';




const agent = new SocksProxyAgent(proxyOptions);

async function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}
async function getJobDescriptions(jobPosts) {
    const descriptions = await Promise.all(jobPosts.map(async (job) => {
        let description = "";
        let retries = 3;  // Number of retry attempts

        while (retries > 0) {
            try {
                // console.log(`Fetching job description for job ID: ${job.jobId}`)
                const response = await axios.get(`https://www.linkedin.com/jobs/view/${job.jobId}/`, { httpAgent: agent, httpsAgent: agent, timeout: 2000 });
                const html = response.data;
                const $ = load(html);
                // Extract the job description HTML
                let descriptionHTML = $('.description__text--rich').html();
                // Re-parse the descriptionHTML with Cheerio
                const $description = load(descriptionHTML);
                // let description = "";

                // Traverse all elements in the content
                $description('*').each((index, element) => {
                    const $el = $description(element);
                
                    // If the element has children, skip processing its content to avoid duplication
                    if ($el.children().length > 0) return;
                
                    // Check the element type and format accordingly
                    switch (element.tagName) {
                        case "li":
                            description += "* " + $el.text().trim() + "\n";
                            break;
                        case "p":
                        case "strong":
                        case "em":
                            description += $el.text().trim() + "\n\n";
                            break;
                    }
                });

                // console.log(description);  // This will print out the formatted job description
                if (description.length>0) break; else {
                    console.log(`Description is null for the https://www.linkedin.com/jobs/view/${job.jobId}/`);
                    break;
                }
            } catch (error) {
                retries--;
                console.log(`Retry attempt for job ID: ${job.jobId}. Remaining retries: ${retries}. Error: ${error.message}`);
                await delay(1000);
            }
        }

        if (description.length == 0 && retries == 0) {
            console.log(`Failed to extract description for job ID: ${job.jobId} after multiple attempts.`);
        }

        return description;
    }));

    // Merge descriptions into jobPosts
    jobPosts.forEach((job, index) => {
        job.description = descriptions[index];
    });
    return jobPosts;
}
async function signIn(supabase){
  const res = await supabase.auth.signInWithPassword({
    email: email,
    password: password,
  });
  return res;
}
async function getJobCards(obj, settings) {
    // Create an array of promises for each page search
    const promises = [];
    const url = obj.url;
    let pages = 1;
    if (settings[0].pages_to_scrape && settings[0].pages_to_scrape > 0) pages = settings[0].pages_to_scrape; else pages = 1;
    for (let i = 0; i < pages; i++) {
        promises.push(fetchJobCardsForPage(url, settings, i));
    }

    // Wait for all promises to resolve and flatten the resulting arrays
    const results = await Promise.all(promises);
    const allJobCards = [].concat(...results).map(card => ({
        ...card,
        user_id: obj.user_id
    }));

    console.log("allJobCards: ", allJobCards.length);
    // console.log("allJobCards: ", allJobCards[0])
    return allJobCards;
}
async function fetchJobCardsForPage(url, settings, i, maxRetries = 3) {
    let fullURL = url + (i * 25).toString();
    let days = 30;
    // console.log(settings)
    if (settings[0].days_to_scrape && settings[0].days_to_scrape > 0) days = settings[0].days_to_scrape; else days = 30;
    for (let attempt = 0; attempt < maxRetries; attempt++) {
        try {
            console.log("going to url: ", fullURL);

            const response = await axios.get(fullURL, { httpAgent: agent, httpsAgent: agent, timeout: 2000 });
            const html = response.data;

            const $ = load(html);
            const jobCards = [];
            
            $('li > div.base-search-card').each((_, node) => {
                let datePosted = null;
                const title = $(node).find('h3.base-search-card__title').text().trim();
                const company = $(node).find('h4.base-search-card__subtitle a').text().trim();
                datePosted = $(node).find('time.job-search-card__listdate').attr('datetime');
                if (!datePosted) {
                    datePosted = $(node).find('time.job-search-card__listdate--new').attr('datetime');
                }
                const location = $(node).find('span.job-search-card__location').text().trim();
                
                const jobIdMatch = $(node).attr('data-entity-urn').match(/\d+$/);
                const jobId = jobIdMatch ? jobIdMatch[0] : null;
                // if (!datePosted) {
                //     // retry again if datePosted is null
                //     throw new Error(`datePosted is null for job ID: ${jobId}`);
                // }
                if (datePosted && new Date(datePosted) < new Date(new Date().setDate(new Date().getDate() - days))) {
                    // console.log("Skipping an old job: datePosted: ", datePosted);
                    return;
                }
                jobCards.push({ title, company, location, datePosted, jobId });
            });
            return jobCards;
        } catch (error) {
            if (error.response && error.response.status === 429 && attempt < maxRetries - 1) {
                console.warn(`Received 429 response. Retrying in 3 seconds... (Retry ${attempt + 1}/${maxRetries})`);
                // await delay(2000);  // Wait for 2 seconds before retrying
            } else {
                console.error(`Error fetching page ${fullURL}:`, error.message);
                // await delay(2000);  // Wait for 2 seconds before retrying
            }
        }
    }
}
function getSearchQueries(queriesRes){
    const searchQueries = queriesRes.data.map(item => {
        let workTypeID = "";
        if (item.work_type == 'Remote') {
            workTypeID = "2";
        } else if (item.work_type == 'Hybrid') {
            workTypeID = "1";
        } else if (item.work_type == 'Onsite') {
            workTypeID = "0";
        } else workTypeID = "";
        return {
            ...item,
            url: `https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search?keywords=${encodeURIComponent(item.search_term)}&location=${encodeURIComponent(item.location)}&f_TPR=&f_WT=${workTypeID}&geoId=&f_TPR=r84600&start=`      
        }
    });
    return searchQueries;
}
function getTltleFilteredJobs(dedupedAllJobs, filtersRes){
    let filter = [];
    let relevantJobs = [];
    //Going through each job and determining whether it should be included in the final list based on user's filters
    for (let i = 0; i < dedupedAllJobs.length; i++) {
        filter = filtersRes.data.filter(item => item.user_id == dedupedAllJobs[i].user_id);
        if (filter.length > 0) {
            if (filter[0].exclude_title_words && dedupedAllJobs[i].title){
                const excludeTitleWordsArray = filter[0].exclude_title_words.split(',').map(word => word.trim());
                if (excludeTitleWordsArray.some(word => dedupedAllJobs[i].title.toLowerCase().includes(word.toLowerCase()))) {
                    // console.log("excluded title: ", dedupedAllJobs[i].title);
                    continue;
                }              
            }
            if (filter[0].exclude_company && dedupedAllJobs[i].company){
                const excludeCompanyWordsArray = filter[0].exclude_company.split(',').map(word => word.trim());
                if (excludeCompanyWordsArray.some(word => dedupedAllJobs[i].company.toLowerCase().includes(word.toLowerCase()))) {
                    // console.log("excluded company: ", dedupedAllJobs[i].company);
                    continue;
                }
            }
            if (filter[0].include_title_words && dedupedAllJobs[i].title){
                const includeTitleWordsArray = filter[0].include_title_words.split(',').map(word => word.trim());
                if (includeTitleWordsArray.some(word => dedupedAllJobs[i].title.toLowerCase().includes(word.toLowerCase()))) {
                    relevantJobs.push(dedupedAllJobs[i]);
                }                
            } else relevantJobs.push(dedupedAllJobs[i]);
        } else relevantJobs.push(dedupedAllJobs[i]);
    }
    return relevantJobs;
}
function getDescriptionFilteredJobs(jobs, filtersRes){
    let filter = [];
    let relevantJobs = [];
    // console.log("jobs: ", jobs.length);
    //Going through each job and determining whether it should be included in the final list based on user's filters
    for (let i = 0; i < jobs.length; i++) {
        filter = filtersRes.data.filter(item => item.user_id == jobs[i].user_id);
        if (filter.length > 0) {
            if (filter[0].exclude_description_words && jobs[i].description.length > 0){
                // console.log("Doing an exclude description filter")
                const excludeDescriptionWordsArray = filter[0].exclude_description_words.split(',').map(word => word.trim());
                const matchingWord = excludeDescriptionWordsArray.find(word => jobs[i].description.toLowerCase().includes(word.toLowerCase()));
                if (matchingWord) {
                    // console.log("excluded description: ", jobs[i].jobId, jobs[i].title, "'", matchingWord, "'");
                    continue;
                } else {
                    relevantJobs.push(jobs[i]);
                    // console.log("included description 2nd if: ", jobs[i].jobId, jobs[i].title);
                }
             } else {
                relevantJobs.push(jobs[i]);
                // console.log("included description 1st if: ", jobs[i].jobId, jobs[i].title);
             }
        } else relevantJobs.push(jobs[i]);
    }
    return relevantJobs;
}
function removeDuplicates(allJobCards) {
    const dedupedAllJobs = allJobCards.reduce((acc, curr) => {
        const jobIdKey = curr.jobId;
        const titleCompanyKey = `${curr.title}_${curr.company}`;

        if (!acc.map.has(jobIdKey) && !acc.titleCompanyMap.has(titleCompanyKey)) {
            acc.map.set(jobIdKey, true);
            acc.titleCompanyMap.set(titleCompanyKey, true);
            acc.result.push(curr);
        }
        return acc;
    }, { map: new Map(), titleCompanyMap: new Map(), result: [] }).result;
    return dedupedAllJobs;
}
//Create function that return current date and time
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
function chunkArray(array, size) {
    const chunked = [];
    let index = 0;
    while (index < array.length) {
      chunked.push(array.slice(index, size + index));
      index += size;
    }
    const urlChunked = chunked.map(chunk => chunk.map(item => item.job_url));
    // console.log("urlChunked: ", urlChunked)
    return urlChunked;
}
async function findDuplicates(batches, supabase) {
    const duplicates = [];
  
    for (const batch of batches) {
        // console.log("batch: ", batch);
      const { data, error } = await supabase
        .from('jobs')
        .select('*')
        .in('job_url', batch);
        // console.log("data: ", data);
      if (error) {
        console.error("Error fetching data:", error);
        continue;
      }
  
      if (data) {
        duplicates.push(...data.map(item => {
            return {
                id: item.id,
                job_url: item.job_url,
            }}));
      }
    }
  
    return duplicates;
}
function chunkArrayQueries(array, chunkSize) {
    const chunks = [];
    for (let i = 0; i < array.length; i += chunkSize) {
        chunks.push(array.slice(i, i + chunkSize));
    }
    return chunks;
}
async function getJobLogo(jobPosts) {
    // console.log("jobPosts: ", jobPosts);
    const logos = await Promise.all(jobPosts.map(async (job) => {
        let description = "";
        let retries = 3;  // Number of retry attempts
        let imageUrl = "";

        while (retries > 0) {
            try {
                console.log("job.job_url: ", job.job_url)
                // console.log(`Fetching job description for job ID: ${job.jobId}`)
                const response = await axios.get(`${job.job_url}`, { httpAgent: agent, httpsAgent: agent, timeout: 2000 });
                const html = response.data;
                const $ = load(html);

                const img = $('img.artdeco-entity-image');
                imageUrl = img.eq(0).attr('data-delayed-url');
                console.log("data-delayed-url: ", imageUrl);

                // console.log(description);  // This will print out the formatted job description
                if (imageUrl.length>0) break; else {
                    console.log(`Image URL is null for the https://www.linkedin.com/jobs/view/${job.jobId}/`);
                    break;
                }
            } catch (error) {
                retries--;
                console.log(`Retry attempt for job ID: ${job.jobId}. Remaining retries: ${retries}. Error: ${error.message}`);
                await delay(1000);
            }
        }

        if (imageUrl.length == 0 && retries == 0) {
            console.log(`Failed to extract description for job ID: ${job.jobId} after multiple attempts.`);
        }

        return imageUrl;
    }));

    // Merge descriptions into jobPosts
    jobPosts.forEach((job, index) => {
        job.logo_url = logos[index];
    });
    return jobPosts;
}
async function getLogo (url) {
    let retries = 1;  // Number of retry attempts
    while (retries > 0) {
        try {
            console.log("job.job_url: ", url)
            // console.log(`Fetching job description for job ID: ${job.jobId}`)
            const response = await axios.get(`${url}`, { httpAgent: agent, httpsAgent: agent, timeout: 2000 });
            const html = response.data;
            const $ = load(html);

            // let imageUrl = $('img[data-ghost-url]').attr('src') || $('img[aria-busy="false"]').attr('src');
            const img = $('img.artdeco-entity-image');
            // console.log ("img: ", img);
            const dataDelayedUrl = img.eq(0).attr('data-delayed-url');
            console.log("data-delayed-url: ", dataDelayedUrl);

            // console.log("imageUrl: ", imageUrl);

            // console.log(description);  // This will print out the formatted job description
            if (imageUrl.length>0) break; else {
                console.log(`Image URL is null for the ${url}`);
                break;
            }
        } catch (error) {
            retries--;
            console.log(`Retry attempt for job. Remaining retries: ${retries}. Error: ${error.message}`);
            await delay(1000);
        }
    }

    if (imageUrl.length == 0 && retries == 0) {
        console.log(`Failed to extract description for job ID: ${job.jobId} after multiple attempts.`);
    }

    return imageUrl;
}
async function main() {

    global.localStorage = new LocalStorage("./scratch");
    const supabase = createClient(url, key,{auth: {storage: global.localStorage,},})
    const supa = await signIn(supabase); //Signing into Supabase
    const queriesRes = await supabase.from('job_queries').select('*')//.eq('user_id', '0b77d408-f32b-453d-8b25-da28f2d8f9fa') // getting all search queries from the database
    const profileRes = await supabase.from('job_profiles').select('*') // getting all job filters from the database
    const { data: settings } = await supabase.from('settings').select('*') // getting all settings from the database

    const uniqueUsers = [...new Set(profileRes.data.map(item => {
        return {
            user_id: item.user_id,
            id: item.id,
    }}))]; // getting unique users from the search queries
    for (let i = 0; i < uniqueUsers.length; i++) {
        const {data: userJobs, error: error} = await supabase.from('user_jobs').select('*').eq('user_id', uniqueUsers[i].user_id).is('job_profile', null); // getting all jobs for the user from the database
        if (error) {
            console.log("error: ", error);
        } else if (userJobs && userJobs.length > 0) {
            console.log("userJobs: ", userJobs.length)
            console.log("User ID: ", uniqueUsers[i].user_id);
            const jobsToUpdate = userJobs.map(item => {
                return {
                    ...item,
                    job_profile: uniqueUsers[i].id,
                    updated_at: getCurrentTime(),
                }
            });
            const {data: updatedJobs, error: error} = await supabase.from('user_jobs').upsert(jobsToUpdate); // updating all jobs for the user in the database
            if (error) {
                console.log("error: ", error);
            }
        } else if (userJobs) {
            console.log("No jobs to update for user: ", uniqueUsers[i].user_id);
        }
    }
    
    console.log("uniqueUsers: ", uniqueUsers);





//!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!

}

const initialMemoryUsage = process.memoryUsage().heapUsed / 1024 / 1024;
const start = performance.now();


await main();



const finalMemoryUsage = process.memoryUsage().heapUsed / 1024 / 1024;
console.log(`Memory used during script execution: ${Math.round((finalMemoryUsage - initialMemoryUsage) * 100) / 100} MB`);
const end = performance.now();
console.log(`Execution time: ${end - start} ms`);

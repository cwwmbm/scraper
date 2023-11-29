import {performance} from 'perf_hooks';
import axios, { all } from 'axios';
import { load } from 'cheerio';
import { SocksProxyAgent } from 'socks-proxy-agent';
import { createClient } from '@supabase/supabase-js'
import { LocalStorage } from 'node-localstorage'
import { v4 as uuidv4 } from 'uuid';
// import { proxyOptions, email, password, url, key } from './settings.js';
import dotenv from 'dotenv';
// import { is } from 'cheerio/lib/api/traversing';
dotenv.config({ path: './.env.local' });

const agent = new SocksProxyAgent(process.env.PROXY);

async function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}
async function signIn(supabase){
    const res = await supabase.auth.signInWithPassword({
      email: process.env.EMAIL,
      password: process.env.PASSWORD,
    });
    return res;
  }
  function chunkArray(array, chunkSize) {
      const chunks = [];
      for (let i = 0; i < array.length; i += chunkSize) {
          chunks.push(array.slice(i, i + chunkSize));
      }
      return chunks;
  }
async function getJobDescriptionsForArray(jobPosts) {
    const descriptions = await Promise.all(jobPosts.map(async (job) => {
        let description = "";
        let descriptionHTML = "";
        let retries = 3;  // Number of retry attempts
        let imageUrl = "";

        while (retries > 0) {
            try {
                // console.log(`Fetching job description for job ID: ${job.jobId}`)
                const response = await axios.get(`https://www.linkedin.com/jobs/view/${job.jobId}/`, { httpAgent: agent, httpsAgent: agent, timeout: process.env.TIMEOUT });
                const html = response.data;
                const $ = load(html);
                // Extract the job description HTML
                descriptionHTML = $('.description__text--rich > section > div').html();
                // Re-parse the descriptionHTML with Cheerio
                const $description = load(descriptionHTML);
                // let description = "";

                // Traverse all elements in the content
                // $description('div.show-more-less-html__markup').contents().each((_, node) => {
                //     const $node = $description(node);
                
                //     // Check if the node is a text node and has non-whitespace content
                //     if (node.type === 'text' && /\S/.test($node.text())) {
                //         description += $node.text().trim() + "\n\n";
                //         return;
                //     }
                
                //     // If the node is an element, process it according to its tag name
                //     if (node.type === 'tag') {
                //         // If the element has no children, process its text content
                //         if ($node.children().length === 0) {
                //             switch (node.tagName) {
                //                 case "li":
                //                     description += "* " + $node.text().trim() + "\n";
                //                     break;
                //                 case "p":
                //                 case "strong":
                //                 case "em":
                //                     description += $node.text().trim() + "\n\n";
                //                     break;
                //                 default:
                //                     description += $node.text().trim() + "\n";
                //             }
                //         } else {
                //             // If the element has children, traverse its leaf nodes (nodes without children) and process them
                //             $node.find(':not(:has(*))').each((_, leaf) => {
                //                 const $leaf = $description(leaf);
                //                 switch (leaf.tagName) {
                //                     case "li":
                //                         description += "* " + $leaf.text().trim() + "\n";
                //                         break;
                //                     case "p":
                //                     case "strong":
                //                     case "em":
                //                         description += $leaf.text().trim() + "\n\n";
                //                         break;
                //                     default:
                //                         description += $leaf.text().trim() + "\n";
                //                 }
                //             });
                //         }
                //     }
                // });
                const img = $('img.artdeco-entity-image');
                imageUrl = img.eq(0).attr('data-delayed-url');

                // console.log(description);  // This will print out the formatted job description
                if (descriptionHTML.length>0) break; else {
                    console.log(`Description is null for the https://www.linkedin.com/jobs/view/${job.jobId}/`);
                    break;
                }
            } catch (error) {
                retries--;
                console.log(`Retry attempt for job ID: ${job.jobId}. Remaining retries: ${retries}. Error: ${error.message}`);
                await delay(1000);
            }
        }

        if (descriptionHTML.length == 0 && retries == 0) {
            console.log(`Failed to extract description for job ID: ${job.jobId} after multiple attempts.`);
            descriptionHTML = "The search engine couldn't extract the description for this job. Please click Go To Job to see the description at the job page."
        }
        if (imageUrl.length == 0 && retries == 0) {
            console.log(`Failed to extract logo for job ID: ${job.jobId} after multiple attempts.`);
        }
        const decrAndLogos = {description: descriptionHTML, imageUrl: imageUrl};
        return decrAndLogos;
    }));

    // Merge descriptions into jobPosts
    jobPosts.forEach((job, index) => {
        job.description = descriptions[index].description;
        job.logo_url = descriptions[index].imageUrl;
    });
    return jobPosts;
}
async function getAllDescriptions(jobPosts, settings) {
    const jobPostsChunks = chunkArray(jobPosts, settings[0].chunk_size);
    const descriptions = [];
    for (const chunk of jobPostsChunks) {
        descriptions.push(await getJobDescriptionsForArray(chunk));
    }
    return [].concat(...descriptions);
}
function getTltleFilteredJobs(records){
    let filter = [];
    let relevantJobs = [];
    //Going through each job and determining whether it should be included in the final list based on user's filters
    for (let i = 0; i < records.length; i++) {
        // filter = records.data.filter(item => item.user_id == records[i].user_id);
        // if (filter.length > 0) {
            if (records[i].title && records[i].exclude_title_words?.length > 0) {
                const excludeTitleWordsArray = records[i].exclude_title_words.split(',').map(word => word.trim());
                if (excludeTitleWordsArray.some(word => records[i].title.toLowerCase().includes(word.toLowerCase()))) {
                    continue;
                }              
            }
            if (records[i].company && records[i].exclude_company?.length > 0) {
                const excludeCompanyWordsArray = records[i].exclude_company.split(',').map(word => word.trim());
                if (excludeCompanyWordsArray.some(word => records[i].company.toLowerCase().includes(word.toLowerCase()))) {
                    // console.log("excluded company: ", records[i].company);
                    continue;
                }
            }
            if (records[i].title && records[i].include_title_words?.length > 0) {
                const includeTitleWordsArray = records[i].include_title_words.split(',').map(word => word.trim());
                if (includeTitleWordsArray.some(word => records[i].title.toLowerCase().includes(word.toLowerCase()))) {
                    relevantJobs.push(records[i]);
                }                
            } else relevantJobs.push(records[i]);
        // } else relevantJobs.push(records[i]);
    }
    console.log("relevant job cards after applying filters to title/company: ", relevantJobs.length)
    return relevantJobs;
}
function getDescriptionFilteredJobs(jobs){
    let relevantJobs = [];
    // console.log("jobs: ", jobs[0]);
    //Going through each job and determining whether it should be included in the final list based on user's filters
    for (let i = 0; i < jobs.length; i++) {
            if (jobs[i].exclude_description_words?.length > 0 && jobs[i].description.length > 0){
                // console.log("Doing an exclude description filter")
                const excludeDescriptionWordsArray = jobs[i].exclude_description_words.split(',').map(word => word.trim());
                // console.log("excludeDescriptionWordsArray: ", excludeDescriptionWordsArray)
                const matchingWord = excludeDescriptionWordsArray.find(word => jobs[i].description.toLowerCase().includes(word.toLowerCase()));
                // console.log("matchingWord: ", matchingWord)
                if (matchingWord) {
                    continue;
                } else {
                    relevantJobs.push(jobs[i]);
                }
             } else {
                relevantJobs.push(jobs[i]);
             }
    }
    return relevantJobs;
}
function removeDuplicateCards(records) {
    const rec = records.reduce((acc, cur) => {
        if (!acc.find(item => item.jobId === cur.jobId && item.user_id === cur.user_id && item.profile_id === cur.profile_id)) {
          acc.push(cur);
        }
        return acc;
      }, []);
    console.log(rec.length)
    return rec;
}
function separateArrays(records) {
    const uniqueJobsMap = new Map();
    const uniqueJobs = [];
    const duplicateJobs = [];
  
    records.forEach((item) => {
      if (uniqueJobsMap.has(item.jobId)) {
        item.id = uniqueJobsMap.get(item.jobId).id;
        duplicateJobs.push(item);
      } else {
        uniqueJobsMap.set(item.jobId, item);
        uniqueJobs.push(item);
      }
    });
    console.log("New unique job cards: ", uniqueJobs.length);
    console.log("Duplicate new job cards for multiple users: ", duplicateJobs.length);
  
    return [uniqueJobs, duplicateJobs];
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
function chunkedJobURLArray(array, size) {
    const chunked = [];
    let index = 0;
    while (index < array.length) {
      chunked.push(array.slice(index, size + index));
      index += size;
    }
    const urlChunked = chunked.map(chunk => chunk.map(item => item.job_url));

    // console.log("urlChunked: ", urlChunked[0])
    return urlChunked;
}
async function findDatabaseDuplicates(records, supabase, settings) {
    const chunks = chunkedJobURLArray(records, settings[0].chunk_size);
    // console.log("chunks: ", chunks.length);
    // console.log("chunks: ", chunks[0]);
    const duplicates = [];
  
    for (const batch of chunks) {
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
                description: item.description,
                // title: item.title,
                // company: item.company,
            }}));
      }
    }
    console.log("Already exist in the database: ", duplicates.length);
    // console.log("duplicates: ", duplicates[0])
  
    return duplicates;
}
async function fetchJobCardsForPage(url, settings, i, maxRetries = 3) {
    let fullURL = url + (i * 25).toString();
    let days = 30;
    // console.log(settings)
    if (settings[0].days_to_scrape && settings[0].days_to_scrape > 0) days = settings[0].days_to_scrape; else days = 30;
    for (let attempt = 0; attempt < maxRetries; attempt++) {
        try {
            console.log("going to url: ", fullURL);

            const response = await axios.get(fullURL, { httpAgent: agent, httpsAgent: agent, timeout: process.env.TIMEOUT });
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
                // console.log("datePosted: ", datePosted);
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
                // console.log("New job:", datePosted)
                jobCards.push({ title, company, location, datePosted, jobId });
            });
            // console.log(jobCards.length)
            // console.log("jobCards: ", jobCards[0])
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
async function getJobCards(obj, settings) {
    // Create an array of promises for each page search
    // console.log("obj: ", obj)
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
        ...obj,
    }));

    console.log("Job cards for the query: ", allJobCards.length);
    return allJobCards;
}
function getSearchQueries(queriesRes){
    const searchQueries = queriesRes.map(item => {
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
async function getJobCardsForAllQueries(queriesRes, settings) {
    const searchQueries = getSearchQueries(queriesRes); //Ammending an array with search URL for each query}
    const queryChunks = chunkArray(searchQueries, settings[0].query_chunk_size);
    console.log("queryChunks: ", queryChunks.length);
    const results = [];
    for (const chunk of queryChunks) {
        const chunkResults = await Promise.all(chunk.map(obj => getJobCards(obj, settings)));
        results.push(...chunkResults);
    }
    // const results = await Promise.all(searchQueries.map(obj => getJobCards(obj))); //Getting Job Cards for each search query
    const allJobCards = [].concat(...results); // Flattening the array of arrays of job cards
    console.log("Grand total all Job Cards: ", allJobCards.length);
    // const jobCardsNoDatePosted = allJobCards.filter(job => !job.datePosted); //Removing jobs that don't have datePosted
    return allJobCards;
}

async function pushKnownJobs(knownJobs, supabase) {
    // console.log("knownJobs: ", knownJobs[0]);
    // console.log(knownJobs.length)
    const relevantJobToUpsert = getDescriptionFilteredJobs(knownJobs);
    console.log("relevantJobToUpsert: ", relevantJobToUpsert.length);
    const jobsToUpsert = relevantJobToUpsert.map(job => {
        return {
            job_id: job.id,
            user_id: job.user_id,
            created_at: new Date().toISOString(),
            is_applied: false,
            is_hidden: false,
            is_interview: false,
            is_rejected: false,
            date_posted: job.date_posted,
            job_profile: job.job_profile,
        }
    });
    // console.log("jobsToUpsert: ", jobsToUpsert[0]);
    const pushUserJobs = await supabase.from('user_jobs').upsert(jobsToUpsert, {onConflict: 'user_id, job_id, job_profile', ignoreDuplicates: true});
    if (pushUserJobs.error) console.log("pushUserJobs error: ", pushUserJobs.error); else console.log("pushUserJobs: ", pushUserJobs);
}

async function main() {
    // return;
     //Supabase connection and getting data from there
    global.localStorage = new LocalStorage("./scratch");
    const supabase = createClient(process.env.URL, process.env.KEY,{auth: {storage: global.localStorage,},})
    const supa = await signIn(supabase); //Signing into Supabase
    const queriesRes = await supabase.from('job_queries').select('*').eq('user_id', '4304bd4b-fabb-4c0a-a038-f836eca01f2d') // getting all search queries from the database
    const profileRes = await supabase.from('job_profiles').select('*') // getting all job filters from the database
    const { data: settings } = await supabase.from('settings').select('*') // getting all settings from the database
    
    // Combine search queries and search profiles into a single array allSearches
    const allSearches = queriesRes.data.map(query => {
        const profile = profileRes.data.find(profile => profile.id === query.profile_id);
        return {
            ...query,
            ...profile,
        }
    });
    const uniqueSearchesSet = new Set();
    const uniqueSearches = [];
    const duplicates = [];
    allSearches.forEach(search => {
        const identifier = `${search.location.toLowerCase()}-${search.work_type}-${search.search_term.toLowerCase()}`;
        
        if (uniqueSearchesSet.has(identifier)) {
            duplicates.push({...search, identifier}); // Add to duplicates if identifier is already seen
        } else {
            uniqueSearchesSet.add(identifier); // Add new identifier to Set
            uniqueSearches.push({...search, identifier}); // Add to uniqueSearches if identifier is new
        }
      });
    console.log("All Searches: ", allSearches.length)
    console.log("Unique searches: ", uniqueSearches.length);
    // console.log("Unique Search:" , uniqueSearches[0]);
    console.log("Duplicate Searches: ", duplicates.length);
    // return;
    // Go through each search query and get all job cards
    const uniqueJobCards = await getJobCardsForAllQueries(uniqueSearches, settings);
    const duplicaJobCards = [];
    console.log("allJobCards: ", uniqueJobCards[0]);
    duplicates.forEach(dup => {
        console.log("dup: ", dup.identifier)
        const matchingJobs = uniqueJobCards.filter(job => job.identifier === dup.identifier);
        matchingJobs.forEach(job => {
            console.log("matchingJob: ", job.title, " ", job.company, " ", job.datePosted, " ", job.jobId);
            duplicaJobCards.push({...dup,
                                title: job.title, 
                                company: job.company,
                                datePosted: job.datePosted,
                                jobId: job.jobId});
        });
        // console.log("matchingJob: ", matchingJobs.length);
        // console.log("matchingJob: ", matchingJobs[0]);
        // console.log("dup: ", dup)
        // duplucaJobCards.push(...dup, matchingJob.title, matchingJob.company, matchingJob.datePosted, matchingJob.jobId);
    })
    console.log("Duplicate Job Cards: ", duplicaJobCards.length);
    // console.log("Duplicate Job Cards: ", duplicaJobCards[0]);
    const allJobCards = [...uniqueJobCards, ...duplicaJobCards];

    // Remove duplicate cards from allJobCards
    const dedupedAllJobs = removeDuplicateCards(allJobCards);
    console.log("dedupedAllJobs: ", dedupedAllJobs.length);

    // Apply title/company filters to the job cards, and add additional properties like url, date_posted, etc.
    const allFilteredCards = getTltleFilteredJobs(dedupedAllJobs).map(job => {
        return {
          ...job,
          id: uuidv4(),
          job_url: `https://www.linkedin.com/jobs/view/${job.jobId}/`,
          date_posted: convertDateToTimestamp(job.datePosted),
        }
    }); 

    // Figure out if job with jobId = 3764303683 is in the array

    console.log("allFilteredCards: ", allFilteredCards.length)

    // Find duplicate jobs in the database
    const knownJobs = await findDatabaseDuplicates(allFilteredCards, supabase, settings);
    console.log("knownJobs: ", knownJobs.length)
    // console.log("knownJobs: ", knownJobs[0])

    // Change the id of knownJobs to match the id of the corresponding job in the database
    const knownJobsWithIDs = knownJobs.map(job => {
        const knownJob = allFilteredCards.find(j => j.job_url === job.job_url);
        return {
            ...job,
            user_id: knownJob.user_id,
            date_posted: knownJob.date_posted,
            job_profile: knownJob.profile_id,
            title: knownJob.title,
            company: knownJob.company,
            exclude_description_words: knownJob.exclude_description_words,
            include_title_words: knownJob.include_title_words,
            exclude_title_words: knownJob.exclude_title_words,
            exclude_company: knownJob.exclude_company,
            include_language: knownJob.include_language,

        }
    })
    // console.log("knownJobsWithIDs: ", knownJobsWithIDs[0])


    // Push known jobs to the user_jobs table
    pushKnownJobs(knownJobsWithIDs, supabase);
    
    // Remove known jobs from allFilteredCards
    const allFilteredCardsWithoutKnownJobs = allFilteredCards.filter(job => !knownJobs.some(dup => dup.job_url === job.job_url));

    // Separate the array into two arrays: one with unique job IDs and one with duplicate job IDs
    const [newJobs, duplicateJobs] = separateArrays(allFilteredCardsWithoutKnownJobs);

    // Get descriptions for all new jobs
    const jobsWithDescription = await getAllDescriptions(newJobs, settings);
    console.log("jobsWithDescription: ", jobsWithDescription.length)

    // Populate the description and logo_url properties of duplicate jobs
    duplicateJobs.forEach(job => {
        const matchingJob = jobsWithDescription.find(j => j.job_url === job.job_url);
        job.description = matchingJob.description;
        job.logo_url = matchingJob.logo_url;
    });
    console.log("duplicateJobs: ", duplicateJobs.length)

    // Filter out jobs that don't match the description filters
    const filteredUniqueJobs = getDescriptionFilteredJobs(jobsWithDescription);
    console.log("filteredUniqueJobs: ", filteredUniqueJobs.length);
    const filteredDuplicateJobs = getDescriptionFilteredJobs(duplicateJobs);
    console.log("filteredDuplicateJobs: ", filteredDuplicateJobs.length);

    //Extract from jobsWithDescription array of jobs that is not in filteredUniqueJobs
    const filteredOutJobs = jobsWithDescription.filter(job => !filteredUniqueJobs.some(dup => dup.job_url === job.job_url));

    // Merge and un-merge the two arrays again to account for the fact that some jobs may have been filtered out in the unique and duplicate arrays
    const filteredJobs = [...filteredUniqueJobs, ...filteredDuplicateJobs];
    const [uniqueFilteredJobs, duplicateFilteredJobs] = separateArrays(filteredJobs);
    console.log("Number of jobs passed filtering to insert into jobs database: ", uniqueFilteredJobs.length);
    console.log("Number of jobs filtered out: ", filteredOutJobs.length)
    console.log("Number of jobs to upsert into user_jobs database: ", filteredJobs.length);

    const filteredOutJobsToInsert = filteredOutJobs.map(row => ({
        id: row.id,
        title: row.title || "Couldn't find title",
        company: row.company || "Couldn't find company",
        location: row.location || '',
        description: row.description || '',
        date_posted: row.date_posted || '',
        created_at: new Date().toISOString(),
        job_url: row.job_url || '',
        logo_url: row.logo_url || '',
    }));

    // Transform the data to match the database for insertion for jobs table
    const jobsToInsert = uniqueFilteredJobs.map(row => ({
        id: row.id || '',
        title: row.title || "Couldn't find title",
        company: row.company || "Couldn't find company",
        location: row.location || '',
        description: row.description || '',
        date_posted: row.date_posted || '',
        created_at: new Date().toISOString(),
        job_url: row.job_url || '',
        logo_url: row.logo_url || '',
      }));      

    // Transform the data to match the database for insertion for user_jobs table
    const userJobsToInsert = filteredJobs.map(row => ({
        job_id: row.id,
        user_id: row.user_id,
        created_at: new Date().toISOString(),
        is_applied: false,
        is_hidden: false,
        is_interview: false,
        is_rejected: false,
        date_posted: row.date_posted,
        notes: "",
        job_profile: row.profile_id,
    }));


    // Insert jobsToInsert into the jobs table
    let insertJobs, insertUserJobs, insertFilteredOutJobs;
    if (jobsToInsert) {
        // console.log("newUserJobsToInsert: ", newUserJobsToInsert.length);
        insertJobs = await supabase.from('jobs').upsert(jobsToInsert, {onConflict: 'job_url', ignoreDuplicates: true});
    }

    if (filteredOutJobsToInsert) {
        // console.log("newUserJobsToInsert: ", newUserJobsToInsert.length);
        insertFilteredOutJobs = await supabase.from('jobs').upsert(filteredOutJobsToInsert, {onConflict: 'job_url', ignoreDuplicates: true});
    }

    // Insert userJobsToInsert into the user_jobs table
    if (!insertJobs.error && userJobsToInsert) {
        // console.log("newUserJobsToInsert: ", newUserJobsToInsert[0]);
        insertUserJobs = await supabase.from('user_jobs').upsert(userJobsToInsert, {onConflict: 'user_id, job_id, job_profile', ignoreDuplicates: true});
    }


    if (insertJobs.error) console.log("insertJobs error: ", insertJobs.error);
    if (insertUserJobs.error) console.log("insertUserJobs error: ", insertUserJobs.error);
    if (insertFilteredOutJobs.error) console.log("insertFilteredOutJobs error: ", insertFilteredOutJobs.error);

}

const initialMemoryUsage = process.memoryUsage().heapUsed / 1024 / 1024;
const start = performance.now();


await main();



const finalMemoryUsage = process.memoryUsage().heapUsed / 1024 / 1024;
console.log(`Memory used during script execution: ${Math.round((finalMemoryUsage - initialMemoryUsage) * 100) / 100} MB`);
const end = performance.now();
console.log(`Execution time: ${end - start} ms`);

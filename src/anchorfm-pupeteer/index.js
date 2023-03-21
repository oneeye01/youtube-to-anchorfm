const puppeteer = require('puppeteer');
const env = require('../environment-variables');

function addUrlToDescription(youtubeVideoInfo) {
  return env.URL_IN_DESCRIPTION
    ? `${youtubeVideoInfo.description}\n${youtubeVideoInfo.url}`
    : youtubeVideoInfo.description;
}

async function setPublishDate(page, navigationPromise, date) {
  console.log('-- Setting publish date');
  const publishDateButtonSelector = '//span[contains(text(),"Publish date:")]/following-sibling::button';
  const [publishDateButton] = await page.$x(publishDateButtonSelector);
  await publishDateButton.click();
  await navigationPromise;

  await resetDatePickerToSelectYears(page, navigationPromise);
  await selectYearInDatePicker(page, navigationPromise, date.year);
  await selectMonthInDatePicker(page, navigationPromise, date.month);
  await selectDayInDatePicker(page, navigationPromise, date.day);

  const confirmButtonSelector = '//span[contains(text(),"Confirm")]/parent::button';
  const [confirmButton] = await page.$x(confirmButtonSelector);
  await confirmButton.click();
  await navigationPromise;
}

async function resetDatePickerToSelectYears(page, navigationPromise) {
  for (let i = 0; i < 2; i += 1) {
    const datePickerSwitchButtonSelector = 'th[class="rdtSwitch"]';
    const datePickerSwitchButton = await page.$(datePickerSwitchButtonSelector);
    await datePickerSwitchButton.click();
    await navigationPromise;
  }
}

async function selectYearInDatePicker(page, navigationPromise, year) {
  const rdtPrev = await page.$('th[class="rdtPrev"]');
  let currentLowestYear = await page.$eval('tbody > tr:first-child > td:first-child', (e) =>
    e.getAttribute('data-value')
  );
  while (parseInt(currentLowestYear, 10) > parseInt(year, 10)) {
    await rdtPrev.click();
    await navigationPromise;

    currentLowestYear = await page.$eval('tbody > tr:first-child > td:first-child', (e) =>
      e.getAttribute('data-value')
    );
  }

  const rdtNext = await page.$('th[class="rdtNext"]');
  let currentHighestYear = await page.$eval('tbody > tr:last-child > td:last-child', (e) =>
    e.getAttribute('data-value')
  );
  while (parseInt(currentHighestYear, 10) < parseInt(year, 10)) {
    await rdtNext.click();
    await navigationPromise;

    currentHighestYear = await page.$eval('tbody > tr:last-child > td:last-child', (e) => e.getAttribute('data-value'));
  }

  const tdYear = await page.$(`tbody > tr > td[data-value="${year}"]`);
  await tdYear.click();
  await navigationPromise;
}

async function selectMonthInDatePicker(page, navigationPromise, month) {
  const [tdMonth] = await page.$x(`//tbody/tr/td[contains(text(),"${month}")]`);
  await tdMonth.click();
  await navigationPromise;
}

async function selectDayInDatePicker(page, navigationPromise, day) {
  const dayWithRemovedZeroPad = parseInt(day, 10);
  const tdDay = await page.$(
    `tbody > tr > td[data-value="${dayWithRemovedZeroPad}"][class*="rdtDay"]:not([class*="rdtOld"]:not([class*="rtdNew"])`
  );
  await tdDay.click();
  await navigationPromise;
}

async function postEpisode(youtubeVideoInfo) {
  let browser;
  try {
    console.log('Launching puppeteer');
    browser = await puppeteer.launch({ args: ['--no-sandbox'], headless: env.PUPETEER_HEADLESS });
    const page = await browser.newPage();

    const navigationPromise = page.waitForNavigation();

    await page.goto('https://podcasters.spotify.com/pod/dashboard/episode/new');

    await page.setViewport({ width: 1600, height: 789 });

    await navigationPromise;

    console.log('Trying to log in');
    /* The reason for the wait is because
    anchorfm can take a little longer to load the form for logging in 
    and because pupeteer treats the page as loaded(or navigated to) 
    even when the form is not showed
    */
    console.log(page);
    await page.waitForSelector('#email');
    await page.type('#email', env.ANCHOR_EMAIL);
    await page.type('#password', env.ANCHOR_PASSWORD);
    await page.click('button[type=submit]');
    await navigationPromise;
    console.log('Logged in');

    console.log('Uploading audio file');
    console.log(document.querySelector('input[type=file]'));
    await page.waitForFunction("document.querySelector('input[type=file]')");
    /* await page.waitForSelector('input[type=file]'); */
    const inputFile = await page.$('input[type=file]');
    await inputFile.uploadFile(env.AUDIO_FILE);

    console.log('Waiting for upload to finish');
    await new Promise((r) => {
      setTimeout(r, 25 * 1000);
    });

    const saveEpisodeButtonSelector = '//span[contains(text(),"Save")]/parent::button[not(boolean(@disabled))]';
    await page.waitForXPath(saveEpisodeButtonSelector, { timeout: env.UPLOAD_TIMEOUT });
    const [saveButton] = await page.$x(saveEpisodeButtonSelector);
    await saveButton.click();
    await navigationPromise;

    console.log('-- Adding title');
    await page.waitForSelector('#title', { visible: true });
    // Wait some time so any field refresh doesn't mess up with our input
    await new Promise((r) => {
      setTimeout(r, 2000);
    });
    await page.type('#title', youtubeVideoInfo.title);

    console.log('-- Adding description');
    await page.waitForSelector('div[role="textbox"]', { visible: true });
    const finalDescription = addUrlToDescription(youtubeVideoInfo);
    await page.type('div[role="textbox"]', finalDescription);

    if (env.SET_PUBLISH_DATE) {
      await setPublishDate(page, navigationPromise, youtubeVideoInfo.uploadDate);
    }

    console.log('-- Selecting content type');
    const selectorForExplicitContentLabel = env.IS_EXPLICIT
      ? 'label[for="podcastEpisodeIsExplicit-true"]'
      : 'label[for="podcastEpisodeIsExplicit-false"]';
    await page.waitForSelector(selectorForExplicitContentLabel, { visible: true });
    const contentTypeLabel = await page.$(selectorForExplicitContentLabel);
    await contentTypeLabel.click();

    if (env.LOAD_THUMBNAIL) {
      console.log('-- Uploading episode art');
      await page.waitForSelector('input[type=file][accept="image/*"]');
      const inputEpisodeArt = await page.$('input[type=file][accept="image/*"]');
      await inputEpisodeArt.uploadFile(env.THUMBNAIL_FILE);

      console.log('-- Saving uploaded episode art');
      const saveThumbnailButtonSelector = '//span[text()="Save"]/parent::button';
      await page.waitForXPath(saveThumbnailButtonSelector);
      const [saveEpisodeArtButton] = await page.$x(saveThumbnailButtonSelector);
      await saveEpisodeArtButton.click();
      await page.waitForXPath('//div[@aria-label="image uploader"]', { hidden: true, timeout: env.UPLOAD_TIMEOUT });
    }

    const saveDraftOrPublishOrScheduleButtonDescription = getSaveDraftOrPublishOrScheduleButtonDescription();
    console.log(`-- ${saveDraftOrPublishOrScheduleButtonDescription.message}`);

    const [saveDraftOrPublishOrScheduleButton] = await page.$x(saveDraftOrPublishOrScheduleButtonDescription.xpath);
    await saveDraftOrPublishOrScheduleButton.click();
    await navigationPromise;

    console.log('Yay');
  } catch (err) {
    throw new Error(`Unable to post episode to anchorfm: ${err}`);
  } finally {
    if (browser !== undefined) {
      await browser.close();
    }
  }
}

function getSaveDraftOrPublishOrScheduleButtonDescription() {
  if (env.SAVE_AS_DRAFT) {
    return {
      xpath: '//button[text()="Save as draft"]',
      message: 'Saving draft',
    };
  }

  if (env.SET_PUBLISH_DATE) {
    return {
      xpath: '//span[text()="Schedule episode"]/parent::button',
      message: 'Scheduling',
    };
  }

  return {
    xpath: '//span[text()="Publish now"]/parent::button',
    message: 'Publishing',
  };
}

module.exports = {
  postEpisode,
};

export async function pause500ifRecordingVideo(page) {
    let isVideoRecorded = (await page.video()) ? true : false;
    if (isVideoRecorded) {
        await page.waitForTimeout(500);
    }
}
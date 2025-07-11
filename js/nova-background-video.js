/**
 * Nova Background Video Controller
 * Created by Cascade 2025-07-10
 * Handles the background video transitions for Nova's mood visualization
 */

document.addEventListener('DOMContentLoaded', () => {
  // Get all background videos
  const videos = document.querySelectorAll('.bg-video');
  let currentVideoIndex = 0;
  
  // Add active class to first video
  videos[0].classList.add('active');
  
  // Start only the first video
  videos[0].play();
  
  // Function to cycle to the next video with fade transition
  function cycleVideo() {
    // Get current and next video indexes
    const currentVideo = videos[currentVideoIndex];
    currentVideoIndex = (currentVideoIndex + 1) % videos.length;
    const nextVideo = videos[currentVideoIndex];
    
    // Prepare next video for playback
    nextVideo.currentTime = 0;
    nextVideo.play();
    
    // Add active class to next video (fade in)
    nextVideo.classList.add('active');
    
    // Remove active class from current video (fade out)
    currentVideo.classList.remove('active');
    
    // Schedule next cycle
    setTimeout(cycleVideo, 180000); // 3 minutes
  }
  
  // Start cycling after 3 minutes
  setTimeout(cycleVideo, 180000); // 3 minutes
});

import requests
import sys
import time
import tempfile
import os
from datetime import datetime
import base64
from io import BytesIO
from PIL import Image
import cv2
import numpy as np

class VideoOCRAPITester:
    def __init__(self, base_url="https://framereader.preview.emergentagent.com"):
        self.base_url = base_url
        self.api_url = f"{base_url}/api"
        self.tests_run = 0
        self.tests_passed = 0
        self.uploaded_files = []
        self.created_jobs = []

    def log_test(self, name, success, details=""):
        """Log test results"""
        self.tests_run += 1
        if success:
            self.tests_passed += 1
            print(f"✅ {name} - PASSED {details}")
        else:
            print(f"❌ {name} - FAILED {details}")
        return success

    def create_test_video(self, duration_seconds=3, fps=10):
        """Create a simple test video with text frames"""
        try:
            # Create temporary video file
            temp_file = tempfile.NamedTemporaryFile(suffix='.mp4', delete=False)
            temp_file.close()
            
            # Video properties
            width, height = 640, 480
            fourcc = cv2.VideoWriter_fourcc(*'mp4v')
            
            # Create video writer
            out = cv2.VideoWriter(temp_file.name, fourcc, fps, (width, height))
            
            # Generate frames with text
            total_frames = duration_seconds * fps
            for i in range(total_frames):
                # Create frame with text
                frame = np.zeros((height, width, 3), dtype=np.uint8)
                
                # Add text to frame
                text = f"Frame {i+1} - Test OCR Text"
                font = cv2.FONT_HERSHEY_SIMPLEX
                font_scale = 1
                color = (255, 255, 255)  # White text
                thickness = 2
                
                # Get text size and center it
                text_size = cv2.getTextSize(text, font, font_scale, thickness)[0]
                text_x = (width - text_size[0]) // 2
                text_y = (height + text_size[1]) // 2
                
                cv2.putText(frame, text, (text_x, text_y), font, font_scale, color, thickness)
                
                # Write frame
                out.write(frame)
            
            out.release()
            return temp_file.name
            
        except Exception as e:
            print(f"Failed to create test video: {str(e)}")
            return None

    def test_api_root(self):
        """Test API root endpoint"""
        try:
            response = requests.get(f"{self.api_url}/")
            success = response.status_code == 200
            details = f"Status: {response.status_code}"
            if success:
                data = response.json()
                details += f", Message: {data.get('message', 'N/A')}"
            return self.log_test("API Root", success, details)
        except Exception as e:
            return self.log_test("API Root", False, f"Error: {str(e)}")

    def test_upload_video(self, video_path):
        """Test video upload endpoint"""
        try:
            with open(video_path, 'rb') as f:
                files = {'file': ('test_video.mp4', f, 'video/mp4')}
                response = requests.post(f"{self.api_url}/upload-video", files=files)
            
            success = response.status_code == 200
            details = f"Status: {response.status_code}"
            
            if success:
                data = response.json()
                self.uploaded_files.append(data)
                details += f", File ID: {data.get('file_id', 'N/A')}"
                return self.log_test("Upload Video", success, details), data
            else:
                error_detail = response.json().get('detail', 'Unknown error') if response.content else 'No response'
                return self.log_test("Upload Video", success, f"{details}, Error: {error_detail}"), None
                
        except Exception as e:
            return self.log_test("Upload Video", False, f"Error: {str(e)}"), None

    def test_upload_invalid_file(self):
        """Test upload with invalid file type"""
        try:
            # Create a text file
            temp_file = tempfile.NamedTemporaryFile(suffix='.txt', delete=False)
            temp_file.write(b"This is not a video file")
            temp_file.close()
            
            with open(temp_file.name, 'rb') as f:
                files = {'file': ('test.txt', f, 'text/plain')}
                response = requests.post(f"{self.api_url}/upload-video", files=files)
            
            # Should fail with 400
            success = response.status_code == 400
            details = f"Status: {response.status_code}"
            
            os.unlink(temp_file.name)
            return self.log_test("Upload Invalid File", success, details)
            
        except Exception as e:
            return self.log_test("Upload Invalid File", False, f"Error: {str(e)}")

    def test_process_video(self, uploaded_file, frame_interval=1.0):
        """Test video processing endpoint"""
        try:
            params = {
                'file_id': uploaded_file['file_id'],
                'filename': uploaded_file['filename'],
                'frame_interval': frame_interval
            }
            
            response = requests.post(f"{self.api_url}/process-video", params=params)
            
            success = response.status_code == 200
            details = f"Status: {response.status_code}"
            
            if success:
                data = response.json()
                self.created_jobs.append(data['job_id'])
                details += f", Job ID: {data.get('job_id', 'N/A')}"
                return self.log_test("Process Video", success, details), data
            else:
                error_detail = response.json().get('detail', 'Unknown error') if response.content else 'No response'
                return self.log_test("Process Video", success, f"{details}, Error: {error_detail}"), None
                
        except Exception as e:
            return self.log_test("Process Video", False, f"Error: {str(e)}"), None

    def test_process_invalid_interval(self, uploaded_file):
        """Test processing with invalid frame interval"""
        try:
            params = {
                'file_id': uploaded_file['file_id'],
                'filename': uploaded_file['filename'],
                'frame_interval': 10.0  # Invalid - too high
            }
            
            response = requests.post(f"{self.api_url}/process-video", params=params)
            
            # Should fail with 400
            success = response.status_code == 400
            details = f"Status: {response.status_code}"
            
            return self.log_test("Process Invalid Interval", success, details)
            
        except Exception as e:
            return self.log_test("Process Invalid Interval", False, f"Error: {str(e)}")

    def test_job_status(self, job_id, wait_for_completion=True):
        """Test job status endpoint"""
        try:
            max_wait_time = 120  # 2 minutes max
            start_time = time.time()
            
            while True:
                response = requests.get(f"{self.api_url}/job/{job_id}")
                
                if response.status_code != 200:
                    return self.log_test("Job Status", False, f"Status: {response.status_code}")
                
                data = response.json()
                status = data.get('status', 'unknown')
                progress = data.get('progress', 0)
                
                print(f"   Job Status: {status}, Progress: {progress}%")
                
                if not wait_for_completion:
                    success = True
                    details = f"Status: {response.status_code}, Job Status: {status}"
                    return self.log_test("Job Status", success, details), data
                
                if status == 'completed':
                    transcripts = data.get('transcripts', [])
                    success = True
                    details = f"Status: {response.status_code}, Completed with {len(transcripts)} transcripts"
                    return self.log_test("Job Status - Completed", success, details), data
                elif status == 'failed':
                    error = data.get('error', 'Unknown error')
                    success = False
                    details = f"Status: {response.status_code}, Job Failed: {error}"
                    return self.log_test("Job Status - Failed", success, details), data
                
                # Check timeout
                if time.time() - start_time > max_wait_time:
                    success = False
                    details = f"Timeout after {max_wait_time}s, Last status: {status}"
                    return self.log_test("Job Status - Timeout", success, details), data
                
                time.sleep(3)  # Wait 3 seconds before next check
                
        except Exception as e:
            return self.log_test("Job Status", False, f"Error: {str(e)}"), None

    def test_job_not_found(self):
        """Test job status with invalid job ID"""
        try:
            fake_job_id = "non-existent-job-id"
            response = requests.get(f"{self.api_url}/job/{fake_job_id}")
            
            # Should fail with 404
            success = response.status_code == 404
            details = f"Status: {response.status_code}"
            
            return self.log_test("Job Not Found", success, details)
            
        except Exception as e:
            return self.log_test("Job Not Found", False, f"Error: {str(e)}")

    def test_list_jobs(self):
        """Test list jobs endpoint"""
        try:
            response = requests.get(f"{self.api_url}/jobs")
            
            success = response.status_code == 200
            details = f"Status: {response.status_code}"
            
            if success:
                data = response.json()
                details += f", Jobs count: {len(data)}"
            
            return self.log_test("List Jobs", success, details)
            
        except Exception as e:
            return self.log_test("List Jobs", False, f"Error: {str(e)}")

    def cleanup(self):
        """Clean up created resources"""
        print("\n🧹 Cleaning up...")
        
        # Delete created jobs
        for job_id in self.created_jobs:
            try:
                response = requests.delete(f"{self.api_url}/job/{job_id}")
                if response.status_code == 200:
                    print(f"   Deleted job: {job_id}")
            except:
                pass

    def run_all_tests(self):
        """Run all API tests"""
        print("🚀 Starting Video OCR API Tests")
        print(f"   Base URL: {self.base_url}")
        print(f"   API URL: {self.api_url}")
        print("=" * 50)
        
        # Test 1: API Root
        self.test_api_root()
        
        # Test 2: Create test video
        print("\n📹 Creating test video...")
        video_path = self.create_test_video()
        if not video_path:
            print("❌ Failed to create test video, stopping tests")
            return 1
        
        try:
            # Test 3: Upload video
            upload_success, uploaded_file = self.test_upload_video(video_path)
            if not upload_success or not uploaded_file:
                print("❌ Video upload failed, stopping tests")
                return 1
            
            # Test 4: Upload invalid file
            self.test_upload_invalid_file()
            
            # Test 5: Process video
            process_success, job_data = self.test_process_video(uploaded_file)
            if not process_success or not job_data:
                print("❌ Video processing failed, stopping tests")
                return 1
            
            job_id = job_data['job_id']
            
            # Test 6: Process with invalid interval
            self.test_process_invalid_interval(uploaded_file)
            
            # Test 7: Job status (immediate check)
            self.test_job_status(job_id, wait_for_completion=False)
            
            # Test 8: Job not found
            self.test_job_not_found()
            
            # Test 9: List jobs
            self.test_list_jobs()
            
            # Test 10: Wait for job completion
            print("\n⏳ Waiting for job completion...")
            completion_success, final_data = self.test_job_status(job_id, wait_for_completion=True)
            
            if completion_success and final_data:
                transcripts = final_data.get('transcripts', [])
                print(f"   Final transcripts count: {len(transcripts)}")
                if transcripts:
                    print(f"   Sample transcript: {transcripts[0].get('text', 'N/A')[:50]}...")
            
        finally:
            # Cleanup
            try:
                os.unlink(video_path)
            except:
                pass
            
            self.cleanup()
        
        # Print results
        print("\n" + "=" * 50)
        print(f"📊 Test Results: {self.tests_passed}/{self.tests_run} passed")
        
        if self.tests_passed == self.tests_run:
            print("🎉 All tests passed!")
            return 0
        else:
            print(f"⚠️  {self.tests_run - self.tests_passed} tests failed")
            return 1

def main():
    tester = VideoOCRAPITester()
    return tester.run_all_tests()

if __name__ == "__main__":
    sys.exit(main())
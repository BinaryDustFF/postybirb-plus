import { Injectable, Logger } from '@nestjs/common';
import { FileSubmission } from './interfaces/file-submission.interface';
import { FileRepositoryService } from 'src/file-repository/file-repository.service';
import { UploadedFile } from 'src/file-repository/uploaded-file.interface';
import { getSubmissionType } from './enums/file-submission-type.enum';
import * as _ from 'lodash';
import { Submission } from '../interfaces/submission.interface';
import { SubmissionRepository } from '../submission.repository';

@Injectable()
export class FileSubmissionService {
  private readonly logger = new Logger(FileSubmissionService.name);

  constructor(
    private readonly repository: SubmissionRepository,
    private readonly fileRepository: FileRepositoryService,
  ) {}

  async createSubmission(
    submission: Submission,
    data: { file: UploadedFile; path: string },
  ): Promise<FileSubmission> {
    const { file, path } = data;
    if (!file) {
      throw new Error('FileSubmission requires a file');
    }

    const locations = await this.fileRepository.insertFile(submission.id, file, path);
    const completedSubmission: FileSubmission = {
      ...submission,
      title: file.originalname,
      primary: {
        location: locations.submissionLocation,
        mimetype: file.mimetype,
        name: file.originalname,
        originalPath: path,
        preview: locations.thumbnailLocation,
        size: file.buffer.length,
        type: getSubmissionType(file.mimetype, file.originalname),
      },
    };

    return completedSubmission;
  }

  async cleanupSubmission(submission: FileSubmission): Promise<void> {
    await this.fileRepository.removeSubmissionFiles(submission);
  }

  // TODO
  async changePrimaryFile(file: UploadedFile, id: string, path: string): Promise<FileSubmission> {
    const submission = (await this.repository.find(id)) as FileSubmission;
    if (!submission) {
      throw new Error('Submission does not exist');
    }

    await this.fileRepository.removeSubmissionFile(submission.primary);
    const locations = await this.fileRepository.insertFile(submission.id, file, path);
    submission.primary = {
      location: locations.submissionLocation,
      mimetype: file.mimetype,
      name: file.originalname,
      originalPath: path,
      preview: locations.thumbnailLocation,
      size: file.buffer.length,
      type: getSubmissionType(file.mimetype, file.originalname),
    };

    await this.repository.update(id, { primary: submission.primary });

    return submission;
  }

  async changeThumbnailFile(file: UploadedFile, id: string, path: string): Promise<FileSubmission> {
    const submission = (await this.repository.find(id)) as FileSubmission;

    if (!file) {
      throw new Error('No file provided');
    }

    if (
      !(
        file.mimetype.includes('image/jpeg') ||
        file.mimetype.includes('image/jpg') ||
        file.mimetype.includes('image/png')
      )
    ) {
      throw new Error('Thumbnail file must be png or jpeg');
    }

    if (!submission) {
      throw new Error('Submission does not exist');
    }

    if (submission.thumbnail) {
      await this.fileRepository.removeSubmissionFile(submission.thumbnail);
    }

    const scaledUpload = this.fileRepository.scaleImage(file, 640);
    const locations = await this.fileRepository.insertFile(submission.id, file, path);
    submission.thumbnail = {
      location: locations.submissionLocation,
      mimetype: scaledUpload.mimetype,
      name: scaledUpload.originalname,
      originalPath: path,
      preview: locations.thumbnailLocation,
      size: scaledUpload.buffer.length,
      type: getSubmissionType(scaledUpload.mimetype, scaledUpload.originalname),
    };

    await this.repository.update(id, { thumbnail: submission.thumbnail });

    return submission;
  }

  async removeThumbnail(id: string): Promise<FileSubmission> {
    const submission = (await this.repository.find(id)) as FileSubmission;
    if (!submission) {
      throw new Error('Submission does not exist');
    }

    if (submission.thumbnail) {
      await this.fileRepository.removeSubmissionFile(submission.thumbnail);
    }

    const copy = _.cloneDeep(submission);
    delete copy.thumbnail;

    await this.repository.update(id, { thumbnail: null });

    return copy;
  }

  async addAdditionalFile(file: UploadedFile, id: string, path: string): Promise<FileSubmission> {
    const submission = (await this.repository.find(id)) as FileSubmission;
    if (!submission) {
      throw new Error('Submission does not exist');
    }

    const copy = _.cloneDeep(submission);
    copy.additional = copy.additional || [];
    const locations = await this.fileRepository.insertFile(submission.id, file, path);
    copy.additional.push({
      location: locations.submissionLocation,
      mimetype: file.mimetype,
      name: file.originalname,
      originalPath: path,
      preview: locations.thumbnailLocation,
      size: file.buffer.length,
      type: getSubmissionType(file.mimetype, file.originalname),
    });

    await this.repository.update(id, { additional: copy.additional });

    return copy;
  }

  async removeAdditionalFile(id: string, location: string): Promise<FileSubmission> {
    const submission = (await this.repository.find(id)) as FileSubmission;
    if (!submission) {
      throw new Error('Submission does not exist');
    }

    const copy = _.cloneDeep(submission);

    if (submission.additional && submission.additional.length) {
      const index = submission.additional.findIndex(a => a.location === location);
      if (index !== -1) {
        await this.fileRepository.removeSubmissionFile(submission.additional[index]);
        copy.additional.splice(index, 1);
      }
    }

    await this.repository.update(id, { additional: copy.additional });

    return copy;
  }

  async duplicateSubmission(submission: FileSubmission): Promise<FileSubmission> {
    // Copy files
    const { id } = submission;
    const duplicate = _.cloneDeep(submission);
    duplicate.primary = await this.fileRepository.copyFileWithNewId(id, duplicate.primary);

    if (duplicate.thumbnail) {
      duplicate.thumbnail = await this.fileRepository.copyFileWithNewId(id, duplicate.thumbnail);
    }

    if (duplicate.additional && duplicate.additional.length) {
      for (let i = 0; i < duplicate.additional.length; i++) {
        duplicate.additional[i] = await this.fileRepository.copyFileWithNewId(
          id,
          duplicate.additional[i],
        );
      }
    }

    return duplicate;
  }
}

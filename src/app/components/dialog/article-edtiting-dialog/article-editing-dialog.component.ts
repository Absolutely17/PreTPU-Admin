import {Component, HostListener, Inject, OnInit, ViewChild} from '@angular/core';
import {AbstractControl, FormControl, FormGroup, Validators} from '@angular/forms';
import {MAT_DIALOG_DATA, MatDialog, MatDialogRef} from '@angular/material/dialog';
import {ErrorService} from '../../../services/error/error.service';
import {MatSnackBar} from '@angular/material/snack-bar';
import {ImageService} from '../../../services/image/image.service';
import {ArticleService} from '../../../services/article/article.service';
import {DialogMode} from '../dialog-mode';
import {Article} from '../../../models/article/article';
import {AppConfig} from '../../../app.config';
import {TdLoadingService} from '@covalent/core/loading';
import {transformResultTextToHtml} from "../../common/ckeditor/utils-function";
import {MatStepper} from "@angular/material/stepper";
import {ConfirmDialogComponent} from "../../common/dialog/confirm-dialog/confirm-dialog.component";

export interface ArticleEditingDialogData {
  articleId: string;
  mode: DialogMode;
  dicts?: any;
}

@Component({
  selector: 'app-article-editing-dialog-component',
  templateUrl: './article-editing-dialog.component.html'
})
export class ArticleEditingDialogComponent implements OnInit {

  @ViewChild("myEditor", { static: false }) myEditor: any;

  backgroundImageStyle = 'body { background-image: ' +
    'url(https://internationals.tpu.ru:8080/api/media/img/7CDAEA5F-BC6D-461B-B214-12A975E88A55) }';

  generalInfoForm: FormGroup;

  textControl: FormControl;

  currentMode: DialogMode;

  dicts: any;

  mode = DialogMode;

  currentArticleId: string;

  imageId: string;

  loaderName = 'loader';

  constructor(
    private dialogRef: MatDialogRef<ArticleEditingDialogComponent>,
    private errorService: ErrorService,
    @Inject(MAT_DIALOG_DATA) data: ArticleEditingDialogData,
    protected snackBar: MatSnackBar,
    private imageService: ImageService,
    private articleService: ArticleService,
    private appConfig: AppConfig,
    private loadingService: TdLoadingService,
    private matDialog: MatDialog
  ) {
    this.loadingService.register(this.loaderName);
    this.currentMode = data.mode;
    this.dicts = data.dicts;
    this.currentArticleId = data.articleId;
    if(data.articleId) {
      this.articleService.getArticleById(data.articleId).subscribe(it => {
        if(it) {
          this.generalInfoForm.patchValue(it);
          if (it.imageId) {
            this.imageId = it.imageId;
          }
          if(this.hasBackgroundStyle(it.text)) {
            this.generalInfoForm.patchValue({useBackground: true});
          } else {
            this.generalInfoForm.patchValue({useBackground: false});
          }
          this.textControl.patchValue(it.text)
          this.loadingService.resolve(this.loaderName);
        }
      });
    } else {
      this.loadingService.resolve(this.loaderName);
    }
  }

  ngOnInit(): void {
    this.generalInfoForm = new FormGroup({}, null, null);
    this.generalInfoForm.addControl('name', new FormControl('', Validators.required));
    this.generalInfoForm.addControl('topic', new FormControl('', Validators.required));
    this.generalInfoForm.addControl('briefText', new FormControl('', null));
    this.generalInfoForm.addControl('language', new FormControl('', Validators.required));
    this.generalInfoForm.addControl('image', new FormControl(null, null));
    this.generalInfoForm.addControl('useBackground', new FormControl(true, Validators.required));
    this.textControl = new FormControl(null, Validators.required);
  }

  isInvalid(name: string): boolean {
    const control = this.get(name);
    return control.touched && control.invalid;
  }

  get(name: string): AbstractControl {
    return this.generalInfoForm.get(name);
  }

  getError(name: string): string {
    const error = this.generalInfoForm.get(name).errors;
    if(error) {
      if(error.required) {
        return 'Обязательно для заполнения';
      }
    }
  }

  cancel(): void {
    this.dialogRef.close();
  }

  accept(): void {
    // @ts-ignore
    this.myEditor.instance.setData(this.textControl.value, () => {
      let htmlText = transformResultTextToHtml(this.textControl.value);
      const useBackground = this.generalInfoForm.get('useBackground').value;
      if(useBackground && !this.hasBackgroundStyle(htmlText)) {
        htmlText = this.addBackgroundStyle(htmlText);
      }
      const articleInfo: Article = {
        name: this.get('name').value,
        topic: this.get('topic').value,
        briefText: this.get('briefText').value,
        text: htmlText,
        language: this.get('language').value,
        imageId: this.imageId
      };
      if(this.currentMode === this.mode.CREATE) {
        this.articleService.create(articleInfo).subscribe((articleId) => {
          this.dialogRef.close(articleId);
        }, error => this.errorService.handleServiceError(error));
      } else {
        this.articleService.update(articleInfo, this.currentArticleId).subscribe(
          () => this.dialogRef.close(this.currentArticleId),
          error => this.errorService.handleServiceError(error)
        );
      }
    });
  }

  private addBackgroundStyle(text: string): string {
    if(!this.hasBackgroundStyle(text)) {
      const lastIndexStyles = text.search('</style>');
      if(lastIndexStyles !== -1) {
        return text.slice(0, lastIndexStyles) + this.backgroundImageStyle + text.slice(lastIndexStyles);
      }
    }
  }

  private hasBackgroundStyle(text: string): boolean {
    return text.indexOf(this.backgroundImageStyle) !== -1;
  }

  delete() {
    this.matDialog.open(ConfirmDialogComponent, {
      data: {
        title: 'Удаление статьи',
        message: 'Вы уверены, что хотите удалить статью?',
        acceptButton: 'Удалить',
        cancelButton: 'Отмена'
      },
      width: '500px',
      disableClose: true
    }).afterClosed().subscribe(it => {
      if(it) {
        this.articleService.delete(this.currentArticleId).subscribe(() => {
          this.snackBar.open('Статья удалена', 'Закрыть', {duration: 3000});
          this.dialogRef.close(true);
        }, error => this.errorService.handleServiceError(error))
      }
    })
  }

  nextStep(stepper: MatStepper) {
    stepper.next();
  }

  prevStep(stepper: MatStepper) {
    stepper.previous();
  }

  selectImage(): void {
    this.loadingService.register(this.loaderName);
    const file = this.get('image').value;
    if (/^image\//.test(file.type)) {
      this.imageService.upload(file).subscribe(it => {
        if (it) {
          this.imageId = it;
          this.loadingService.resolve(this.loaderName);
        }
      });
    } else {
      this.snackBar.open('Можно загружать только изображения',
        'Закрыть', {duration: 3000});
      this.loadingService.resolve(this.loaderName);
    }
  }

  openImage(): void {
    let image = new Image();
    image.src = this.appConfig.webServiceFullUrl + '/media/img/' + this.imageId;
    let win = window.open('');
    win.document.write(image.outerHTML);
  }
}

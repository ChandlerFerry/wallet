import { ChangeDetectorRef, Component, ElementRef, OnInit, ViewChild } from '@angular/core';
import { FormBuilder, FormControl, Validators } from '@angular/forms';
import { MatCheckbox, MatCheckboxChange } from '@angular/material/checkbox';
import { MatDialog } from '@angular/material/dialog';
import { UnLockComponent } from '../lock/unlock/unlock.component';
import { WalletService } from '../services/wallet.service';
import { QubicHelper } from 'src/lib/qubic/qubicHelper';
import { MatSnackBar } from '@angular/material/snack-bar';
import { ApiService } from '../services/api.service';
import { Router, ActivatedRoute, ParamMap } from '@angular/router';
import { UpdaterService } from '../services/updater-service';
import { CurrentTickResponse, Transaction } from '../services/api.model';
import { TranslocoService } from '@ngneat/transloco';
import { concatMap, of } from 'rxjs';

@Component({
  selector: 'app-wallet',
  templateUrl: './payment.component.html',
  styleUrls: ['./payment.component.scss']
})
export class PaymentComponent implements OnInit {


  private selectedDestinationId: any;
  public maxAmount: number = 0;
  public currentTick = 0;

  @ViewChild('selectedDestinationId', {
    static: false
  }) set selectedDestinationIdContent(content: any) {
    if (content) { // initially setter gets called with undefined
      this.selectedDestinationId = content;
    }
  }

  public tickOverwrite = false;
  public selectedAccountId = false;

  private destinationValidators = [Validators.required, Validators.minLength(60), Validators.maxLength(60)];
  private txTemplate: Transaction | undefined;

  transferForm = this.fb.group({
    sourceId: [''],
    destinationId: ["", this.destinationValidators],
    selectedDestinationId: [""],
    amount: [10000, [Validators.required, Validators.min(1)]],
    tick: [0, [Validators.required]],
  });

  constructor(
    private t: TranslocoService,
    private router: Router, private us: UpdaterService, private fb: FormBuilder, private route: ActivatedRoute, private changeDetectorRef: ChangeDetectorRef, private api: ApiService, private _snackBar: MatSnackBar, public walletService: WalletService, private dialog: MatDialog) {
    const state = this.router.getCurrentNavigation()?.extras.state;
    if (state && state['template']) {
      this.txTemplate = state['template'];
    }
  }

  ngOnInit(): void {
    this.us.currentTick.subscribe(tick => {
      this.currentTick = tick;
      this.transferForm.controls.tick.addValidators(Validators.min(tick));
      if (!this.tickOverwrite) {
        this.transferForm.controls.tick.setValue(tick + 10);
      }
    })
    this.transferForm.controls.sourceId.valueChanges.subscribe(s => {
      if (s) {
        // try to get max amount
        this.getMaxAmount(s);
        if (this.transferForm.controls.selectedDestinationId.value == this.transferForm.controls.sourceId.value) {
          this.transferForm.controls.selectedDestinationId.setValue(null);
        }
      }
    });

    this.route.queryParams.subscribe(params => {
      if (params['publicId']) {
        const publicId = params['publicId'];
        this.transferForm.controls.sourceId.setValue(publicId);
      }
    });
    this.route.params.subscribe(params => {
      if (params['receiverId']) {
        const publicId = params['receiverId'];
        this.transferForm.controls.destinationId.setValue(publicId);
      }
      if (params['amount']) {
        const amount = params['amount'];
        this.transferForm.controls.amount.setValue(amount);
      }
    });

    if (this.txTemplate) {
      this.fillFromTemplate(this.txTemplate);
    }
  }

  fillFromTemplate(tx: Transaction) {
    this.transferForm.controls.amount.setValue(tx.amount);
    this.transferForm.controls.sourceId.setValue(tx.sourceId);
    this.transferForm.controls.destinationId.setValue(tx.destId);
  }

  getMaxAmount(publicId: string) {
    this.us.currentBalance.subscribe(s => {
      if (s && s.length > 0 && s.find(f => f.publicId == publicId)) {
        this.maxAmount = s.find(f => f.publicId == publicId)?.currentEstimatedAmount ?? s.find(f => f.publicId == publicId)?.epochBaseAmount ?? 0;
      } else {
        this.maxAmount = 0;
      }
    });
  }

  setAmounToMax(addAmount: number = 0) {
    this.transferForm.controls.amount.setValue(this.maxAmount + addAmount);
  }

  init() {
    this.transferForm.reset();
    this.transferForm.controls.amount.setValue(1);
    this.us.forceUpdateCurrentTick();
  }

  onSubmit(): void {
    if (!this.walletService.privateKey) {
      this._snackBar.open(this.t.translate('paymentComponent.messages.pleaseUnlock'), this.t.translate('general.close'), {
        duration: 5000,
        panelClass: "error"
      });
    }
    if (this.transferForm.valid) {
      this.walletService.revealSeed((<any>this.transferForm.controls.sourceId.value)).then(s => {
        let destinationId = this.selectedAccountId ? this.transferForm.controls.selectedDestinationId.value : this.transferForm.controls.destinationId.value;
        of(this.transferForm.controls.tick.value!).pipe(
          concatMap(data => {
            if (!this.tickOverwrite) {
              // this line is the one I have a problem with
              return this.api.getCurrentTick();
            } else {
              // this line returns fine
              return of(<CurrentTickResponse>{
                tick: data - 10, // fake because we add it afterwards; todo: do that right!
              });
            }
          })).subscribe(tick => {
            console.log("TICK", tick);
            new QubicHelper().createTransaction(s, destinationId!, this.transferForm.controls.amount.value!, tick.tick+10).then(tx => {
              // hack to get uintarray to array for sending to api
              this.api.submitTransaction({ SignedTransaction: this.walletService.arrayBufferToBase64(tx) }).subscribe(r => {
                if (r && r.id) {
                  this._snackBar.open(this.t.translate('paymentComponent.messages.storedForPropagation', {txid: r.id }) , this.t.translate('general.close'), {
                    duration: 10000,
                  });
                  // this.init();
                  this.us.loadCurrentBalance();
                  this.router.navigate(['/']);
                }
              }, er => {
                this._snackBar.open(this.t.translate('paymentComponent.messages.failedToSend'), this.t.translate('general.close'), {
                  duration: 5000,
                  panelClass: "error"
                });
              });
            });
          });
      }).catch(e => {
        this._snackBar.open(this.t.translate('paymentComponent.messages.failedToDecrypt'), this.t.translate('general.close'), {
          duration: 10000,
          panelClass: "error"
        });
      });
    } else {
      this._snackBar.open(this.t.translate('paymentComponent.messages.failedValidation'), this.t.translate('general.close'), {
        duration: 5000,
        panelClass: "error"
      });
    }
  }

  toggleDestinationSelect() {
    this.selectedAccountId = !this.selectedAccountId;
    this.changeDetectorRef?.detectChanges();
    if (this.selectedAccountId) {
      this.selectedDestinationId.open();
      this.transferForm.controls.selectedDestinationId.addValidators([Validators.required]);
      this.transferForm.controls.destinationId.clearValidators();
      this.transferForm.controls.destinationId.updateValueAndValidity();
      this.transferForm.controls.selectedDestinationId.updateValueAndValidity();
    } else {
      this.transferForm.controls.destinationId.addValidators(this.destinationValidators);
      this.transferForm.controls.selectedDestinationId.clearAsyncValidators();
      this.transferForm.controls.destinationId.updateValueAndValidity();
      this.transferForm.controls.selectedDestinationId.updateValueAndValidity();
    }
    this.changeDetectorRef?.detectChanges();
  }
  getSeeds(isDestination = false) {
    return this.walletService.getSeeds().filter(f => !isDestination || f.publicId != this.transferForm.controls.sourceId.value)
  }

  loadKey() {
    const dialogRef = this.dialog.open(UnLockComponent, { restoreFocus: false });
  }
}

